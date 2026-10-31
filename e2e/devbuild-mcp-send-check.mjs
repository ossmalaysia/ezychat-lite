// Dev Build check for the MCP send tool with a real MCP client (the official SDK client over Streamable
// HTTP, as AI assistants use it) against a running Dev Build (--fake-wa --mode dev, temp data, fresh setup).
// Usage: node e2e/devbuild-mcp-send-check.mjs <port>
// Prints PASS/FAIL per step; never calls a model or a real WhatsApp number.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { cookieSession } from './devbuild-client.mjs';

const PORT = Number(process.argv[2] ?? 7490);
const BASE = `http://127.0.0.1:${PORT}`;
const CUSTOMER = '60198887766@s.whatsapp.net';
let failed = 0;
/** Server text in a detail stays on one line, so it can never fake a PASS/FAIL line. */
const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ');
const check = (ok, step, detail = '') => {
  if (!ok) failed++;
  const extra = detail ? '  (' + oneLine(detail) + ')' : '';
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + step + extra);
};

const api = cookieSession(BASE);

async function connect(secret) {
  const client = new Client({ name: 'devbuild-check', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), {
      requestInit: { headers: { authorization: `Bearer ${secret}` } },
    }),
  );
  return client;
}

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
const setup = await api('GET', '/setup/status');
if (setup.json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);
check(
  (await api('PATCH', '/integrations/mcp', { enabled: true })).json?.enabled === true,
  'AI assistant access turned on',
);
await api('POST', '/dev/fake-incoming', {
  chatJid: CUSTOMER,
  text: 'Do you deliver to Bayan Lepas?',
  senderName: 'Hafiz',
});

const reader = (await api('POST', '/integrations/tokens', { name: 'reader', expiresInDays: 30 }))
  .json;
const sender = (
  await api('POST', '/integrations/tokens', { name: 'sender', expiresInDays: 30, canSend: true })
).json;
check(
  reader.token.canSend === false && sender.token.canSend === true,
  'tokens created: one read-only, one can send',
);

const readClient = await connect(reader.secret);
const readTools = (await readClient.listTools()).tools.map((t) => t.name);
check(
  !readTools.includes('send_message') && readTools.includes('get_messages'),
  'read-only token: no send_message',
  readTools.join(','),
);
await readClient.close();

const client = await connect(sender.secret);
const info = client.getServerVersion();
check(info?.title === 'EzyChat Lite', 'server names the edition', `${info?.name} / ${info?.title}`);
const tools = (await client.listTools()).tools;
const send = tools.find((t) => t.name === 'send_message');
check(
  send?.annotations?.readOnlyHint === false && send?.annotations?.openWorldHint === true,
  'send_message listed with readOnly false, openWorld true',
);

const chats = JSON.parse(
  (await client.callTool({ name: 'list_chats', arguments: {} })).content[0].text,
);
const jid = chats.chats.find((c) => c.name === 'Hafiz')?.jid;
check(Boolean(jid), 'list_chats finds the customer chat', jid);
const text = 'Yes, we deliver to Bayan Lepas. Delivery is RM5.';
const r = await client.callTool({
  name: 'send_message',
  arguments: { jid, text, requestId: 'devbuild-0001' },
});
const sent = JSON.parse(r.content[0].text);
check(!r.isError && sent.duplicate === false, 'send_message sends', JSON.stringify(sent));
const again = JSON.parse(
  (
    await client.callTool({
      name: 'send_message',
      arguments: { jid, text, requestId: 'devbuild-0001' },
    })
  ).content[0].text,
);
check(again.duplicate === true, 'same requestId: not sent twice');
const stranger = await client.callTool({
  name: 'send_message',
  arguments: { jid: '60100000000@s.whatsapp.net', text: 'hi', requestId: 'devbuild-0002' },
});
check(stranger.isError === true, 'unknown number refused', stranger.content[0].text);
await new Promise((res) => setTimeout(res, 1500));
const msgs = (await api('GET', `/chats/${encodeURIComponent(jid)}/messages`)).json.messages;
const mine = msgs.filter((m) => m.fromMe && m.body === text);
check(
  mine.length === 1 && ['sent', 'delivered', 'read'].includes(mine[0].status),
  'inbox shows the reply once, delivered by fake WhatsApp',
  mine.map((m) => m.status).join(','),
);
check(mine[0]?.viaAssistant === true, 'inbox marks the reply "via AI assistant"');
const audit = (await api('GET', '/audit?limit=20')).json;
const rows = (audit.entries ?? audit.rows ?? audit.items ?? []).filter(
  (e) => e.action === 'mcp.send',
);
check(
  rows.length === 1 && !JSON.stringify(rows).includes('Bayan'),
  'one mcp.send audit row, without the text',
  String(rows.length),
);
check(
  !tools.some((t) => t.name === 'send_to_new_number'),
  'a token that can only send has no send_to_new_number',
);
await client.close();

// New numbers: a separate option, listed with the ban warning first.
const outreach = (
  await api('POST', '/integrations/tokens', {
    name: 'outreach',
    expiresInDays: 30,
    canSend: true,
    canMessageNewNumbers: true,
  })
).json;
check(outreach.token.canMessageNewNumbers === true, 'token created that can message new numbers');
const outClient = await connect(outreach.secret);
const newTool = (await outClient.listTools()).tools.find((t) => t.name === 'send_to_new_number');
check(
  newTool?.description.startsWith('WARNING: WhatsApp can ban') &&
    newTool?.annotations?.readOnlyHint === false,
  'send_to_new_number listed with the ban warning first',
);
const NEW_PHONE = '60197776655';
const NEW_JID = NEW_PHONE + '@s.whatsapp.net';
const started = await outClient.callTool({
  name: 'send_to_new_number',
  arguments: {
    phone: '+60 19-777 6655',
    text: 'Thank you for visiting our booth. Here is the menu you asked for.',
    requestId: 'devbuild-new-0001',
  },
});
const startedResult = JSON.parse(started.content[0].text);
check(
  !started.isError &&
    startedResult.newChat === true &&
    startedResult.chatJid === NEW_JID &&
    /WhatsApp can ban/.test(startedResult.warning),
  'send_to_new_number starts the chat and returns the warning',
  JSON.stringify({ newChat: startedResult.newChat, chatJid: startedResult.chatJid }),
);
const known = JSON.parse(
  (
    await outClient.callTool({
      name: 'send_to_new_number',
      arguments: { phone: '60198887766', text: 'Following up.', requestId: 'devbuild-new-0002' },
    })
  ).content[0].text,
);
check(
  known.newChat === false && known.chatJid === jid,
  'a number with a chat gets an ordinary reply',
);
const bad = await outClient.callTool({
  name: 'send_to_new_number',
  arguments: { phone: '0123', text: 'hi', requestId: 'devbuild-new-0003' },
});
check(bad.isError === true, 'a bad number is refused', bad.content[0].text);
await outClient.close();
await new Promise((res) => setTimeout(res, 1500));
const newMsgs = (await api('GET', `/chats/${encodeURIComponent(NEW_JID)}/messages`)).json.messages;
check(
  newMsgs.length === 1 && newMsgs[0].fromMe && newMsgs[0].viaAssistant === true,
  'the new chat holds one message marked "via AI assistant"',
  newMsgs.map((m) => m.status).join(','),
);
const audit2 = (await api('GET', '/audit?limit=50')).json;
const newChatRows = (audit2.entries ?? audit2.rows ?? audit2.items ?? []).filter(
  (e) => e.action === 'mcp.new_chat',
);
check(
  newChatRows.length === 1 && !JSON.stringify(newChatRows).includes('booth'),
  'one mcp.new_chat audit row, without the text',
  String(newChatRows.length),
);

// Token permissions: the owner lets the read-only token send, without a new token or reconnecting.
const listNames = async (secret) => {
  const c = await connect(secret);
  const names = (await c.listTools()).tools.map((t) => t.name);
  await c.close();
  return names;
};
const granted = await api('PATCH', `/integrations/tokens/${reader.token.id}`, {
  canSend: true,
  canMessageNewNumbers: false,
});
check(
  granted.status === 200 && granted.json.token.canSend === true,
  'owner turns on sending for the read-only token',
);
check(
  (await listNames(reader.secret)).includes('send_message'),
  'the same token lists send_message on its next connection',
);
await api('PATCH', `/integrations/tokens/${reader.token.id}`, {
  canSend: false,
  canMessageNewNumbers: false,
});
check(
  !(await listNames(reader.secret)).includes('send_message'),
  'turned off again: send_message is gone',
);
const audit3 = (await api('GET', '/audit?limit=50')).json;
const updates = (audit3.entries ?? audit3.rows ?? audit3.items ?? []).filter(
  (e) => e.action === 'api_token.update',
);
check(updates.length === 2, 'two api_token.update audit rows', String(updates.length));
console.log(failed ? `\n${failed} step(s) FAILED` : '\nall steps PASS');
process.exit(failed ? 1 : 0);
