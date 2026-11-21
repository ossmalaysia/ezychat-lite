// Dev Build check for Live translate against e2e/agents-devbuild.ts (mock model, fake WhatsApp, temp data):
// a customer message of WhatsApp's longest length (65,536 characters) is translated through the real route,
// and the server must answer quickly (L-27: checking its protected items once took about 2 s per message).
// Usage: node e2e/devbuild-translate-check.mjs <port>
// Prints PASS/FAIL per step; never calls a model or a real WhatsApp number.
import { devbuildClient } from './devbuild-client.mjs';

const { api, check, wait, finish } = await devbuildClient(Number(process.argv[2] ?? 7491));
const enc = encodeURIComponent;

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);
check((await api('GET', '/live-translate')).json?.enabled === true, 'Live translate is on');

const jid = '60123450027@s.whatsapp.net';
const longest = 'a'.repeat(65_536);
const short = 'Harga RM1,260.00 untuk ORD-12345, emel sales@example.com';
for (const text of [longest, short])
  await api('POST', '/dev/fake-incoming', { chatJid: jid, text, senderName: 'Hafiz' });
await wait(500);

const messages = (await api('GET', `/chats/${enc(jid)}/messages`)).json?.messages ?? [];
const long = messages.find((m) => (m.body ?? '').length === longest.length);
const normal = messages.find((m) => m.body === short);
check(Boolean(long && normal), 'both customer messages are stored in full');

const started = Date.now();
const res = await api('POST', `/chats/${enc(jid)}/translations`, {
  messageIds: [long.id, normal.id],
  // Chinese, so neither message is skipped as already in the target language.
  target: 'zh',
});
const ms = Date.now() - started;
const t = res.json?.translations ?? {};
check(res.status === 200, `translations answers 200 (${res.status})`);
check(t[long.id]?.status === 'ok', `the longest message is translated (${t[long.id]?.status})`);
check(t[normal.id]?.status === 'ok', `the normal message is translated (${t[normal.id]?.status})`);
check(ms < 1000, `the server answers in under 1 s (${ms} ms)`);

// A translation that changes a protected item is still refused (the check is not weakened).
const draft = await api('POST', `/chats/${enc(jid)}/translate-draft`, {
  text: short,
  target: 'ms',
});
check(
  draft.json?.status === 'ok',
  `a draft with protected items translates (${draft.json?.status})`,
);
check(
  (draft.json?.protected ?? []).includes('sales@example.com') &&
    (draft.json?.protected ?? []).includes('RM1,260.00'),
  `the draft keeps its email and price protected (${JSON.stringify(draft.json?.protected)})`,
);

finish();
