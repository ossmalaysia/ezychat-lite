// Dev Build check for the Zoho CRM connector against e2e/agents-devbuild.ts (mock model, fake
// WhatsApp, fake Zoho, temp data). Start the runner without --max-inboxes, then:
//   node e2e/devbuild-zoho-check.mjs <port>
// Prints PASS/FAIL per step; never calls Zoho, a model or a real WhatsApp number.
const PORT = Number(process.argv[2] ?? 7491);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)
  throw new Error('The port must be an integer between 1024 and 65535.');
const BASE = `http://127.0.0.1:${PORT}`;
/** Only this local Dev Build: links the server hands back must point at it. */
const local = (link) => {
  const url = new URL(link, BASE);
  if (url.origin !== BASE) throw new Error('Refusing a link outside the local Dev Build');
  return url.href;
};
let failed = 0;
const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ');
const check = (ok, step, detail = '') => {
  if (!ok) failed++;
  const extra = detail ? '  (' + oneLine(detail) + ')' : '';
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + step + extra);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await fetch(BASE + '/api/health');
if (health.headers.get('x-agents-devbuild') !== 'mock-ai')
  throw new Error('Run this only against e2e/agents-devbuild.ts (mock model)');

let cookie = '';
/** One API path of the local Dev Build: plain segments only (ids from the server are data). */
function apiUrl(path) {
  if (
    !/^(\/[\w%@.:-]+)+$/.test(path) ||
    path.split('/').some((part) => part === '..' || part === '.')
  )
    throw new Error(`Unexpected API path: ${path}`);
  return local(`/api${path}`);
}
async function api(method, path, body) {
  const res = await fetch(apiUrl(path), {
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
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { html: text };
  }
  return { status: res.status, json };
}
const code = (r) => r.json?.error?.code ?? r.json?.error;

/** The newest AI message in a chat after `after` AI messages, once sent, within `ms`, or null. */
async function aiReply(jid, aiUserId, after, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const res = await api('GET', `/chats/${encodeURIComponent(jid)}/messages`);
    const mine = (res.json?.messages ?? []).filter((m) => m.sentByUserId === aiUserId);
    // Wait until it went out: a customer message while it is queued cancels it (and the AI answers again).
    if (mine.length > after && mine.at(-1).status !== 'pending') return mine.at(-1);
    await wait(500);
  }
  return null;
}
async function say(jid, text, senderName = 'Kavitha') {
  await api('POST', '/dev/fake-incoming', { chatJid: jid, text, senderName });
}
const agentBody = (enabled) => ({
  displayName: 'Kopi Apong AI',
  enabled,
  instructions: '',
  handoffRules: '',
});
const activity = async () => (await api('GET', '/connectors/zoho-crm/activity')).json.activity;
const leads = async () => (await api('GET', '/dev/fake-zoho')).json.leads;
const record = async (jid) => (await api('GET', `/chats/${encodeURIComponent(jid)}/zoho-crm`)).json;
const lines = async (jid) =>
  ((await api('GET', `/chats/${encodeURIComponent(jid)}`)).json.events ?? [])
    .filter((e) => e.type === 'ai_tool_used')
    .map((e) => e.payload.crm?.action);
const JASON = '60129001234@s.whatsapp.net';
const SETTINGS = {
  find: true,
  addLeads: true,
  ownerId: null,
  leadSource: 'WhatsApp',
  includeRequest: true,
};

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);
await api('PUT', '/ai', agentBody(false));
const agent = (await api('GET', '/ai')).json.agents[0];
check(!!agent, 'the AI agent exists', agent?.id);

// 1. Sign in through the fake Zoho in the EU data centre.
let status = (await api('GET', '/connectors/zoho-crm')).json;
check(status.state === 'disconnected', 'starts disconnected (fake Zoho app)', status.state);
const start = (await api('POST', '/connectors/zoho-crm/connect', { region: 'eu' })).json;
const consent = await (await fetch(local(start.authorizationUrl))).text();
const accept = /id="accept" href="([^"]+)"/.exec(consent)?.[1]?.replaceAll('&#38;', '&');
check(!!accept, 'the consent page offers Accept', start.authorizationUrl);
const back = await fetch(local(accept));
check(back.status === 200, 'Zoho returns to the loopback callback', back.status);
const progress = (await api('GET', `/connectors/zoho-crm/connect/${start.requestId}`)).json;
check(
  progress.status === 'done',
  'the waiting page learns the sign-in is done',
  JSON.stringify(progress),
);
status = (await api('GET', '/connectors/zoho-crm')).json;
check(
  status.state === 'connected' && status.region === 'eu' && status.org && status.users.length > 0,
  'connected: organisation, users and the EU site',
  JSON.stringify({ state: status.state, region: status.region, org: status.org }),
);
check(!JSON.stringify(status).includes('fake-zoho-'), 'no token reaches the browser');
check((await fetch(local(accept))).status >= 400, 'the same callback link cannot be used twice');

// 2. Settings: Add new leads without Find is refused; saved; the agent turns on with Zoho as a source.
check(
  (await api('PUT', `/connectors/zoho-crm/agents/${agent.id}`, { ...SETTINGS, find: false }))
    .status === 400,
  'Add new leads without Find the customer is refused (400)',
);
const saved = await api('PUT', `/connectors/zoho-crm/agents/${agent.id}`, SETTINGS);
check(saved.status === 200 && saved.json.addLeads, 'settings saved', saved.status);
const on = await api('PUT', `/ai/agents/${agent.id}`, agentBody(true));
check(
  on.status === 200 && on.json.agent.enabled,
  'the agent turns on (Zoho CRM counts as a source)',
  code(on) ?? on.status,
);

// 3. A known lead is found by number; the chat shows one "found" line.
await say(JASON, 'Hi CRM, any promotion this week?', 'Jason');
const found = await aiReply(JASON, agent.userId, 0);
check(
  found?.body === 'crm=found lead Jason Lim',
  'the AI finds the lead by WhatsApp number',
  found?.body,
);
check(
  JSON.stringify(await lines(JASON)) === '["found"]',
  'one "AI found the customer" line',
  JSON.stringify(await lines(JASON)),
);
check(
  (await record(JASON)).record?.status === 'Contacted',
  'the customer panel shows the lead and its status',
);

// 4. A new number: not found, then a lead with what the customer wrote; never twice.
const jid = `6013${String(Date.now()).slice(-7)}@s.whatsapp.net`;
await say(jid, 'Hello CRM, catering for 80 pax?');
const notFound = await aiReply(jid, agent.userId, 0);
check(notFound?.body === 'crm=not-found', 'a new number is not in Zoho CRM', notFound?.body);
const before = await leads();
await say(jid, 'LEAD FAKE please');
const refused = await aiReply(jid, agent.userId, 1);
check(
  /pass only details the customer wrote/.test(refused?.body ?? '') && (await leads()) === before,
  'a name the customer did not write is refused',
  refused?.body,
);
await say(jid, 'I am Kavitha Menon from Bright LEAD NAME Kavitha Menon COMPANY Bright');
const added = await aiReply(jid, agent.userId, 2);
check(
  /^Added as a lead/.test(added?.body ?? '') && (await leads()) === before + 1,
  'the AI adds one lead',
  added?.body,
);
await say(jid, 'Again LEAD NAME Kavitha Menon');
const again = await aiReply(jid, agent.userId, 3);
check(
  /^Already added/.test(again?.body ?? '') && (await leads()) === before + 1,
  'a second lead is never added',
  again?.body,
);
const panel = (await record(jid)).record;
check(
  panel?.addedBy === 'ai' &&
    panel?.request === 'Catering quote for an office lunch' &&
    /crm\.zoho\.eu\/crm\//.test(panel?.url ?? ''),
  'the customer panel shows the AI lead, its summary and the EU link',
  JSON.stringify(panel),
);
const kinds = (await activity()).map((a) => a.kind);
check(
  kinds.includes('added') && kinds.includes('not_found') && kinds.includes('found'),
  'Activity: found, not found, added',
  kinds.join(','),
);
check(!JSON.stringify(await activity()).includes('catering'), 'Activity holds no chat text');

// 5. Try it adds nothing.
const tryIt = await api('POST', '/ai/try', {
  question: 'LEAD NAME Try Person',
  knowledge: { displayName: 'Kopi Apong AI', instructions: '', handoffRules: '' },
});
check(
  tryIt.status === 200 && (await leads()) === before + 1,
  'Try it adds nothing',
  JSON.stringify(tryIt.json?.lookups?.map((l) => [l.tool, l.notRun])),
);

// 6. Zoho down: the AI still answers, nothing handed over.
await api('POST', '/dev/fake-zoho', { state: 'unavailable' });
const down = `6013${String(Date.now() + 1).slice(-7)}@s.whatsapp.net`;
await say(down, 'CRM are you open?', 'Ali');
const downReply = await aiReply(down, agent.userId, 0);
check(
  downReply?.body === 'crm=unavailable',
  'the AI still answers while Zoho is down',
  downReply?.body,
);
const downChat = (await api('GET', `/chats/${encodeURIComponent(down)}`)).json;
check(
  downChat.chat?.assignedTo === agent.userId,
  'the chat stays with the AI (no hand-over)',
  JSON.stringify(downChat.chat?.assignedTo),
);
status = (await api('GET', '/connectors/zoho-crm')).json;
check(status.state === 'unavailable', 'the connector shows Can’t reach Zoho', status.state);

// 7. Expired, then Disconnect keeps the settings.
await api('POST', '/dev/fake-zoho', { state: 'expired' });
check(
  (await api('GET', '/connectors/zoho-crm')).json.state === 'expired',
  'expired sign-in shows Sign in again',
);
await api('POST', '/dev/fake-zoho', { state: 'ok' });
const off = await api('POST', '/connectors/zoho-crm/disconnect');
check(off.json.state === 'disconnected', 'Disconnect');
check(
  (await api('GET', `/connectors/zoho-crm/agents/${agent.id}`)).json.addLeads === true,
  'settings are kept for next time',
);

console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
