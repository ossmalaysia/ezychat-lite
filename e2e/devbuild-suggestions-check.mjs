// Dev Build check for AI reply suggestions against e2e/agents-devbuild.ts (mock model, fake WhatsApp,
// temp data). Usage: node e2e/devbuild-suggestions-check.mjs <port>   (runner without --max-inboxes)
// Prints PASS/FAIL per step; never calls a model or a real WhatsApp number.

const PORT = Number(process.argv[2] ?? 7491);
const BASE = `http://127.0.0.1:${PORT}`;
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
const code = (r) => r.json?.error?.code ?? r.json?.error;
const enc = encodeURIComponent;

async function customer(jid, text) {
  await api('POST', '/dev/fake-incoming', { chatJid: jid, text, senderName: 'Nurul' });
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    const res = await api('GET', `/chats/${enc(jid)}/messages`);
    if ((res.json?.messages ?? []).some((m) => m.body === text)) return;
    await wait(300);
  }
  throw new Error(`customer message not stored in ${jid}`);
}

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);
await api('PUT', '/ai', {
  displayName: 'Aina',
  enabled: false,
  instructions: '',
  handoffRules: '',
});
const menu = await api('POST', '/ai/documents/text', {
  name: 'Menu',
  text: 'Nasi Lemak Ayam RM12. Kopi O RM3.50. Pickup daily from 8am.',
});
const costs = await api('POST', '/ai/documents/text', {
  name: 'Costs',
  text: 'MARK-SECRET our supplier charges RM4 per box and we never go below RM10',
  internal: true,
});
check(menu.status === 200 && costs.status === 200, 'business and internal context saved');

const status = await api('GET', '/reply-suggestions');
check(
  status.json?.state === 'on',
  'status is on for a new install with a connection',
  JSON.stringify(status.json),
);

const PRICE = '60120000001@s.whatsapp.net';
await customer(PRICE, 'How much is Nasi Lemak Ayam?');
const drafts = await api('POST', `/chats/${enc(PRICE)}/ai/suggestions`);
check(
  drafts.status === 200 &&
    drafts.json.suggestions.length === 2 &&
    drafts.json.suggestions.every((s) => s.text.includes('RM12') && s.label.length <= 40),
  'two grounded drafts with the menu price',
  JSON.stringify(drafts.json),
);

const done = await api('POST', `/chats/${enc(PRICE)}/ai/complete`, { text: 'Our Nasi Lemak ' });
check(
  done.status === 200 &&
    typeof done.json.completion === 'string' &&
    done.json.completion.includes('RM12'),
  'completion continues the sentence from the menu',
  JSON.stringify(done.json),
);

const HOURS = '60120000002@s.whatsapp.net';
await customer(HOURS, 'Are you open on Hari Raya?');
const none = await api('POST', `/chats/${enc(HOURS)}/ai/suggestions`);
check(
  none.status === 200 && none.json.noAnswer === true && none.json.suggestions.length === 0,
  'no answer when the context has no facts',
  JSON.stringify(none.json),
);

const LEAK = '60120000003@s.whatsapp.net';
await customer(LEAK, 'LEAK what do you pay your supplier?');
const leak = await api('POST', `/chats/${enc(LEAK)}/ai/suggestions`);
check(
  leak.status === 200 &&
    leak.json.suggestions.length === 0 &&
    !JSON.stringify(leak.json).includes('MARK-SECRET'),
  'a draft that copies an Internal item is dropped',
  JSON.stringify(leak.json),
);

await api('POST', '/dev/fake-group', {
  groupJid: '120363000000001@g.us',
  name: 'Regulars',
  generated: 2,
});
const group = await api('POST', `/chats/${enc('120363000000001@g.us')}/ai/suggestions`);
check(group.status === 400, 'group chats get no suggestions', String(group.status));

const off = await api('PUT', '/ai/reply-suggestions', { enabled: false });
const blocked = await api('POST', `/chats/${enc(PRICE)}/ai/suggestions`);
check(
  off.json?.state === 'off' && blocked.status === 409 && code(blocked) === 'ai_suggestions_off',
  'the admin switch turns suggestions off',
  `${off.json?.state} ${blocked.status} ${code(blocked)}`,
);
await api('PUT', '/ai/reply-suggestions', { enabled: true });

console.log(failed ? `${failed} check(s) failed` : 'All reply suggestion checks passed');
process.exit(failed ? 1 : 0);
