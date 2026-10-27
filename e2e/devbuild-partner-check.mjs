// Dev Build check for partner (MCP) connectors from the signed connector list, against
// e2e/agents-devbuild.ts (mock model, fake WhatsApp, temp data) and the local partner MCP test server.
//   node e2e/partner-mcp/cli.mjs --port 7610 --control-token devbuild-partner   (prints env lines)
//   <those env lines> npx tsx --conditions=ezychat-source e2e/agents-devbuild.ts --fake-wa --port 7491
//   node e2e/devbuild-partner-check.mjs <port> [partner origin, default https://127.0.0.1:7610]
// Prints PASS/FAIL per step; never calls a model, a real partner or a real WhatsApp number.
const PORT = Number(process.argv[2] ?? 7491);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)
  throw new Error('The port must be an integer between 1024 and 65535.');
const BASE = `http://127.0.0.1:${PORT}`;
const PARTNER = new URL(process.argv[3] ?? 'https://127.0.0.1:7610');
if (PARTNER.hostname !== '127.0.0.1') throw new Error('The partner test server runs on 127.0.0.1');
// Demo values of the test server (e2e/partner-mcp/README.md).
const API_KEY = 'pk_test_kedai_4242';
const CONTROL_TOKEN = 'devbuild-partner';
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
  const extra = detail ? '  (' + oneLine(detail).slice(0, 300) + ')' : '';
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
  return { status: res.status, json, headers: res.headers, text };
}
const code = (r) => r.json?.error?.code ?? r.json?.error;

/** Switches a test endpoint of the partner server: ok, down, refused, rpc_error. */
async function partnerState(endpoint, state) {
  // The test server's certificate is self-signed; trust it through NODE_EXTRA_CA_CERTS.
  const res = await fetch(new URL('/_control', PARTNER), {
    method: 'POST',
    headers: { authorization: `Bearer ${CONTROL_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, state }),
  });
  if (!res.ok) throw new Error(`partner control answered ${res.status}`);
}

/** The newest AI message in a chat after `after` AI messages, once sent, within `ms`, or null. */
async function aiReply(jid, aiUserId, after, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const res = await api('GET', `/chats/${encodeURIComponent(jid)}/messages`);
    const mine = (res.json?.messages ?? []).filter((m) => m.sentByUserId === aiUserId);
    if (mine.length > after && mine.at(-1).status !== 'pending') return mine.at(-1);
    await wait(500);
  }
  return null;
}
async function say(jid, text) {
  await api('POST', '/dev/fake-incoming', { chatJid: jid, text, senderName: 'Mei Ying' });
}
const activity = async () =>
  (await api('GET', '/connectors/mcp/test-kedai/activity')).json.activity;
const agentBody = (enabled) => ({
  displayName: 'Kedai AI',
  enabled,
  instructions: '',
  handoffRules: '',
});

/** `<date>T<hh:mm>:00+08:00` on the next weekday (the AI's time zone is Asia/Kuala_Lumpur). */
function nextWeekdayAt(hhmm) {
  for (let d = 1; d <= 7; d++) {
    const day = new Date(Date.now() + d * 86_400_000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(day);
    const get = (type) => parts.find((p) => p.type === type).value;
    if (!['Sat', 'Sun'].includes(get('weekday')))
      return `${get('year')}-${get('month')}-${get('day')}T${hhmm}:00+08:00`;
  }
  throw new Error('no weekday found');
}
const AT_10 = nextWeekdayAt('10:00');
const AT_23 = nextWeekdayAt('23:00');

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

// 1. The gallery comes from the signed test list, with its icons.
const gallery = (await api('POST', '/connectors/list/refresh')).json;
const kedai = gallery.connectors?.find((c) => c.entry.id === 'test-kedai');
check(
  gallery.status?.state === 'loaded' && kedai?.fit === 'ok' && !kedai.delisted,
  'the signed test list is downloaded and checked (state loaded)',
  JSON.stringify({ state: gallery.status?.state, n: gallery.connectors?.length }),
);
const icon = await api('GET', `/connectors/icons/${kedai?.entry.icon?.file}`);
check(
  icon.status === 200 &&
    icon.headers.get('content-type')?.startsWith('image/svg+xml') &&
    icon.headers.get('x-content-type-options') === 'nosniff' &&
    /sandbox/.test(icon.headers.get('content-security-policy') ?? ''),
  'the icon is served from the local copy with nosniff and a sandbox CSP',
  icon.status,
);
check(
  (await api('GET', '/connectors/icons/..%2Flist-v1.json')).status === 404 &&
    (await api('GET', '/connectors/icons/unknown.svg')).status === 404,
  'an icon the list does not name is 404',
);

// 2. API key: a wrong key is refused, the right one connects; only its end comes back.
const wrong = await api('POST', '/connectors/mcp/test-kedai/connect', {
  fields: { key: 'pk_wrong_0000' },
});
check(wrong.status >= 400 && code(wrong) === 'refused', 'a wrong key is refused', code(wrong));
const connected = await api('POST', '/connectors/mcp/test-kedai/connect', {
  fields: { key: API_KEY },
});
const view = connected.json?.connection;
check(
  connected.status === 200 && view?.state === 'connected' && view?.keyEnd === '4242',
  'the right key connects; the page gets only the key end',
  JSON.stringify(view),
);
check(!connected.text.includes(API_KEY), 'the key never comes back');

// 3. Per agent: look-ups start on, the tool that changes data starts off.
let settings = (await api('GET', `/connectors/mcp/test-kedai/agents/${agent.id}`)).json;
check(
  settings.tools?.find_invoice === true &&
    settings.tools?.check_stock === true &&
    settings.tools?.create_quotation === false,
  'look-ups on, Create quotation off by default',
  JSON.stringify(settings.tools),
);
const on = await api('PUT', `/ai/agents/${agent.id}`, agentBody(true));
check(
  on.status === 200 && on.json.agent.enabled,
  'the agent turns on (the partner look-ups count as a source)',
  code(on) ?? on.status,
);

// 4. A look-up in a live chat: checked, shown in the chat, kept in Activity without chat text.
const jid = `6012${String(Date.now()).slice(-7)}@s.whatsapp.net`;
await say(jid, 'Do you have STOCK KA-HB-1KG in stock');
const stockReply = await aiReply(jid, agent.userId, 0);
check(
  /KA-HB-1KG/.test(stockReply?.body ?? '') && /in_stock/.test(stockReply?.body ?? ''),
  'the AI checks stock at the partner',
  stockReply?.body,
);
await say(jid, `QUOTE KA-HB-1KG x5 @${AT_10} NAME Mei Ying mei.ying@example.com`);
const off = await aiReply(jid, agent.userId, 1);
check(
  off?.body === 'create_quotation=not-offered',
  'Create quotation is not offered while it is off',
  off?.body,
);

// 5. Switch Create quotation on; every declared guard holds in a new chat.
settings = (
  await api('PUT', `/connectors/mcp/test-kedai/agents/${agent.id}`, {
    settings: settings.settings,
    tools: { ...settings.tools, create_quotation: true },
  })
).json;
check(settings.tools?.create_quotation === true, 'Create quotation switched on and saved');

const jid2 = `6013${String(Date.now()).slice(-7)}@s.whatsapp.net`;
let n = 0;
async function step(text) {
  await say(jid2, text);
  return (await aiReply(jid2, agent.userId, n++))?.body ?? '';
}
const first = await step(`QUOTE KA-HB-1KG x5 @${AT_10} NAME Mei Ying mei.ying@example.com`);
check(!/Q-\d+/.test(first), 'nothing is created before the AI proposed it (confirm first)', first);
const noLookup = await step(`QUOTE KA-HB-1KG x5 @${AT_10} NAME Mei Ying mei.ying@example.com`);
check(
  !/Q-\d+/.test(noLookup),
  'a SKU no look-up found in this chat is refused (value from check_stock)',
  noLookup,
);
await step('STOCK KA-HB-1KG please');
const late = await step(`QUOTE KA-HB-1KG x5 @${AT_23} NAME Mei Ying mei.ying@example.com`);
check(!/Q-\d+/.test(late), 'a delivery outside the delivery hours is refused (within)', late);
const noEmail = await step(`QUOTE KA-HB-1KG x5 @${AT_10} NAME Mei Ying`);
check(!/Q-\d+/.test(noEmail), 'a missing customer email is refused (from the customer)', noEmail);
const done = await step(`QUOTE KA-HB-1KG x5 @${AT_10} NAME Mei Ying mei.ying@example.com`);
check(/Q-\d+/.test(done), 'with every guard met the quotation is created', done);

const acts = await activity();
const reasons = acts.filter((a) => a.kind === 'refused').map((a) => a.reason);
check(
  acts.some((a) => a.kind === 'checked') &&
    acts.some((a) => a.kind === 'done' && a.tool === 'create_quotation') &&
    ['confirm_first', 'value_from', 'within', 'from_customer'].every((r) => reasons.includes(r)),
  'Activity lists the look-ups, the refusals with their reasons and the change',
  JSON.stringify({ kinds: acts.map((a) => a.kind), reasons }),
);
check(
  !JSON.stringify(acts).includes('QUOTE') && !JSON.stringify(acts).includes('mei.ying'),
  'Activity keeps no customer text',
);
const detail = (await api('GET', `/chats/${encodeURIComponent(jid2)}`)).json;
check(
  (detail.events ?? []).some((e) => e.type === 'ai_tool_used'),
  'the chat shows what the AI looked up and did',
);

// 6. Try it never changes data.
const doneBefore = (await activity()).filter((a) => a.kind === 'done').length;
const tried = await api('POST', `/ai/agents/${agent.id}/try`, {
  question: `QUOTE KA-HB-1KG x5 @${AT_10} NAME Mei Ying mei.ying@example.com`,
  knowledge: { displayName: 'Kedai AI', instructions: '', handoffRules: '' },
});
check(
  tried.status === 200 &&
    !/Q-\d+/.test(JSON.stringify(tried.json)) &&
    (await activity()).filter((a) => a.kind === 'done').length === doneBefore,
  'Try it creates nothing',
  JSON.stringify(tried.json).slice(0, 200),
);

// 7. The partner is down: the AI hands the chat over and Activity says it failed.
await partnerState('api-key', 'down');
const jid3 = `6014${String(Date.now()).slice(-7)}@s.whatsapp.net`;
await say(jid3, 'STOCK KA-KY-400 please');
let failedRow = false;
for (let i = 0; i < 60 && !failedRow; i++) {
  await wait(500);
  failedRow = (await activity()).some((a) => a.kind === 'failed');
}
const handedOver = (await api('GET', `/chats/${encodeURIComponent(jid3)}`)).json;
check(
  failedRow && handedOver?.assigneeUserId !== agent.userId,
  'a partner that is down: the call fails, is in Activity, and the AI does not keep the chat',
  JSON.stringify({ failedRow, assignee: handedOver?.assigneeUserId }),
);
await partnerState('api-key', 'ok');

// 8. Disconnect: the agent settings stay for the next connection.
const gone = await api('POST', '/connectors/mcp/test-kedai/disconnect');
check(
  gone.status === 200 && gone.json?.state === 'disconnected',
  'Disconnect',
  JSON.stringify(gone.json),
);
const kept = (await api('GET', `/connectors/mcp/test-kedai/agents/${agent.id}`)).json;
check(kept.tools?.create_quotation === true, 'the agent settings stay after Disconnect');

console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
