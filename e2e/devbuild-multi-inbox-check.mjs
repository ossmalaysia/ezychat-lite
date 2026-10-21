// Dev Build check for several WhatsApp numbers (inboxes), with a real MCP client (the official SDK
// client over Streamable HTTP) against a running Dev Build started with
// `--fake-wa --mode dev --max-inboxes 3` on a fresh temp data folder.
// Usage: node e2e/devbuild-multi-inbox-check.mjs <port>
// Prints PASS/FAIL per step; never calls a model or a real WhatsApp number.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = Number(process.argv[2] ?? 7490);
const BASE = `http://127.0.0.1:${PORT}`;
const CUSTOMER = '60198881122@s.whatsapp.net';
const IN_CATERING = `${CUSTOMER}#2`;
let failed = 0;
const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ');
const check = (ok, step, detail = '') => {
  if (!ok) failed++;
  const extra = detail ? '  (' + oneLine(detail) + ')' : '';
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + step + extra);
};

/** A signed-in browser-like session (its own cookie). */
function session() {
  let cookie = '';
  return async (method, path, body) => {
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
  };
}

async function connect(secret) {
  const client = new Client({ name: 'devbuild-multi-inbox', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), {
      requestInit: { headers: { authorization: `Bearer ${secret}` } },
    }),
  );
  return client;
}
const json = (r) => JSON.parse(r.content[0].text);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const api = session();
const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);

// Inboxes
let list = (await api('GET', '/inboxes')).json;
check(
  list.maxInboxes === 3 && list.inboxes.length === 1 && list.inboxes[0].id === 1,
  'a fresh install has one inbox and room for 3',
);
const agent = (
  await api('POST', '/users', {
    username: 'daniel',
    displayName: 'Daniel',
    role: 'agent',
    password: 'daniel-pass-123',
  })
).json;
const users = (await api('GET', '/users')).json;
const daniel = (users.users ?? users).find((u) => u.id === agent.id);
check(daniel?.inboxIds?.join() === '1', 'a new agent joins the only inbox', daniel?.inboxIds);
const catering = await api('POST', '/inboxes', { name: 'Catering', memberIds: [] });
check(catering.status === 201 && catering.json.id === 2, 'Catering is inbox 2', catering.status);
check(
  (await api('GET', '/inboxes')).json.inboxes.find((i) => i.id === 2)?.status.state === 'qr',
  'a new inbox waits for its QR scan',
);
await api('POST', '/dev/fake-link', { inboxId: 2 });
await wait(300);
list = (await api('GET', '/inboxes')).json;
check(
  list.inboxes.find((i) => i.id === 2)?.status.state === 'open',
  'the scan links Catering',
  list.inboxes.find((i) => i.id === 2)?.number,
);
check(
  (await api('DELETE', '/inboxes/1')).json?.error?.code === 'primary_inbox',
  'the first inbox cannot be removed',
);

// One customer, two numbers
await api('POST', '/dev/fake-incoming', {
  chatJid: CUSTOMER,
  text: 'Kopi for 2?',
  senderName: 'Hafiz',
});
await api('POST', '/dev/fake-incoming', {
  chatJid: CUSTOMER,
  text: 'Catering for 40 on Saturday?',
  senderName: 'Hafiz',
  inboxId: 2,
});
const chats = (await api('GET', '/chats?status=open')).json.chats;
check(
  chats.some((c) => c.jid === CUSTOMER && c.inboxId === 1) &&
    chats.some((c) => c.jid === IN_CATERING && c.inboxId === 2),
  'one customer writing to both numbers is two chats',
);
check(
  (await api('GET', '/chats?inbox=2')).json.chats.every((c) => c.inboxId === 2),
  'the inbox filter narrows the list',
);

// Agent scope (Daniel: inbox 1 only)
const asAgent = session();
await asAgent('POST', '/auth/login', { username: 'daniel', password: 'daniel-pass-123' });
await asAgent('POST', '/auth/change-password', {
  currentPassword: 'daniel-pass-123',
  newPassword: 'daniel-next-123', // NOSONAR: throwaway password of a temp Dev Build user
});
const agentChats = (await asAgent('GET', '/chats')).json.chats ?? [];
check(
  agentChats.some((c) => c.jid === CUSTOMER) && !agentChats.some((c) => c.jid === IN_CATERING),
  'the agent sees only the chat of inbox 1',
);
check(
  (await asAgent('GET', `/chats/${encodeURIComponent(IN_CATERING)}`)).status === 404,
  'the agent gets 404 for the Catering chat',
);
check(
  (await asAgent('GET', `/chats/${encodeURIComponent(IN_CATERING)}/messages`)).status === 404,
  'the agent gets 404 for its messages',
);

// MCP with a real client
await api('PATCH', '/integrations/mcp', { enabled: true });
const token = (
  await api('POST', '/integrations/tokens', {
    name: 'multi',
    expiresInDays: 30,
    canSend: true,
    canMessageNewNumbers: true,
  })
).json;
const client = await connect(token.secret);
const listed = json(await client.callTool({ name: 'list_chats', arguments: {} }));
const both = listed.chats.filter((c) => c.jid === CUSTOMER || c.jid === IN_CATERING);
check(
  both.length === 2 && both.every((c) => typeof c.inboxId === 'number' && c.inboxName),
  'list_chats lists both chats with their inbox',
  both.map((c) => `${c.jid}:${c.inboxName}`).join(' '),
);
const stats = json(await client.callTool({ name: 'get_stats', arguments: {} }));
check(Array.isArray(stats.byInbox) && stats.byInbox.length === 2, 'get_stats has a row per inbox');
const reply = await client.callTool({
  name: 'send_message',
  arguments: { jid: IN_CATERING, text: 'Yes, 40 pax is fine.', requestId: 'multi-0001' },
});
check(!reply.isError, 'send_message replies into the Catering chat', reply.content[0].text);
const noInbox = await client.callTool({
  name: 'send_to_new_number',
  arguments: { phone: '+60 19-555 0101', text: 'Hello from the booth', requestId: 'multi-0002' },
});
check(
  noInbox.isError === true && /inbox_required/.test(noInbox.content[0].text),
  'send_to_new_number asks which number to send from',
);
const fromCatering = await client.callTool({
  name: 'send_to_new_number',
  arguments: {
    phone: '+60 19-555 0101',
    text: 'Hello from the booth',
    requestId: 'multi-0003',
    inboxId: 2,
  },
});
const started = fromCatering.isError ? {} : json(fromCatering);
check(
  started.chatJid === '60195550101@s.whatsapp.net#2',
  'send_to_new_number from Catering starts the chat in Catering',
  started.chatJid ?? fromCatering.content[0].text,
);
await client.close();
await wait(1500);
const msgs = (await api('GET', `/chats/${encodeURIComponent(IN_CATERING)}/messages`)).json.messages;
check(
  msgs.some((m) => m.fromMe && m.body === 'Yes, 40 pax is fine.' && m.viaAssistant),
  'the inbox shows the assistant reply in the Catering chat',
);
check(
  !(await api('GET', `/chats/${encodeURIComponent(CUSTOMER)}/messages`)).json.messages.some(
    (m) => m.fromMe,
  ),
  'nothing was sent into the inbox 1 chat',
);

// Remove
check((await api('DELETE', '/inboxes/2')).status === 204, 'Catering is removed');
const after = await api('POST', `/chats/${encodeURIComponent(IN_CATERING)}/messages`, {
  clientId: 'multi-after-1',
  text: 'still there?',
});
check(after.json?.error?.code === 'inbox_removed', 'sending into a removed inbox is refused');
check(
  (await api('GET', `/chats/${encodeURIComponent(IN_CATERING)}`)).status === 200,
  'its chat stays readable for admins',
);

console.log(failed ? `${failed} step(s) FAILED` : 'All steps passed');
process.exit(failed ? 1 : 0);
