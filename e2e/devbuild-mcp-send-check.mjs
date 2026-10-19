// Dev Build check for the MCP send tool with a real MCP client (the official SDK client over Streamable
// HTTP, as AI assistants use it) against a running Dev Build (--fake-wa --mode dev, temp data, fresh setup).
// Usage: node e2e/devbuild-mcp-send-check.mjs <port>
// Prints PASS/FAIL per step; never calls a model or a real WhatsApp number.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = Number(process.argv[2] ?? 7490);
const BASE = `http://127.0.0.1:${PORT}`;
const CUSTOMER = '60198887766@s.whatsapp.net';
let cookie = '';
let failed = 0;
const check = (ok, step, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  (${detail})` : ''}`);
};

async function api(method, path, body) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: {
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

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
const audit = (await api('GET', '/audit?limit=20')).json;
const rows = (audit.entries ?? audit.rows ?? audit.items ?? []).filter(
  (e) => e.action === 'mcp.send',
);
check(
  rows.length === 1 && !JSON.stringify(rows).includes('Bayan'),
  'one mcp.send audit row, without the text',
  String(rows.length),
);
await client.close();
console.log(failed ? `\n${failed} step(s) FAILED` : '\nall steps PASS');
process.exit(failed ? 1 : 0);
