// Dev Build check for emoji reactions (docs/dev-build-checks.md): on a Dev Build seeded by
// e2e/marketing-screenshots.mjs (fake WhatsApp, temp data), reactions arrive through the fake phone,
// change, go away, group per person, and are still there after a server restart.
// Usage: node e2e/devbuild-reactions-check.mjs <port> run       (before the restart)
//        node e2e/devbuild-reactions-check.mjs <port> restart   (after it: the stored state)
const [port, mode = 'run'] = process.argv.slice(2);
if (!/^\d+$/.test(port ?? '') || !['run', 'restart'].includes(mode))
  throw new Error('usage: devbuild-reactions-check.mjs <port> run|restart');
const BASE = `http://127.0.0.1:${port}`;
const PRIYA = '60128814455@s.whatsapp.net';
const GROUP = '120363025550001@g.us';

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE },
  body: JSON.stringify({ username: 'aisyah', password: 'demo-pass-123' }),
});
if (!login.ok) throw new Error(`login ${login.status}`);
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
const call = async (method, path, body) => {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { origin: BASE, cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
};
const message = async (chat, text) => {
  const { messages } = await call('GET', `/chats/${encodeURIComponent(chat)}/messages`);
  const m = messages.filter((x) => x.body?.startsWith(text)).at(-1);
  if (!m) throw new Error(`no message "${text}"`);
  return m;
};
const summary = (m) =>
  m.reactions
    .map((r) => `${r.emoji} ${r.fromMe ? 'phone' : r.senderName || r.senderJid}`)
    .sort()
    .join(', ') || '(none)';
let failed = 0;
const expectReactions = async (label, chat, text, want) => {
  const got = summary(await message(chat, text));
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
};
const react = async (chat, text, body) =>
  call('POST', '/dev/fake-reaction', { messageId: (await message(chat, text)).id, ...body });

if (mode === 'run') {
  await expectReactions('seeded DM', PRIYA, 'The rider is 5 minutes away', '❤️ Priya Nair');
  await react(PRIYA, 'The rider is 5 minutes away', { emoji: '👍' });
  await expectReactions('changed', PRIYA, 'The rider is 5 minutes away', '👍 Priya Nair');
  await react(PRIYA, 'So sorry Priya', { emoji: '😂' });
  await react(PRIYA, 'So sorry Priya', { emoji: '' });
  await expectReactions('removed', PRIYA, 'So sorry Priya', '(none)');
  await react(GROUP, 'Is the durian cendol back', {
    emoji: '😋',
    senderJid: '60126677889@s.whatsapp.net',
    senderName: 'Nurul Huda',
  });
  await expectReactions(
    'one per person in a group',
    GROUP,
    'Is the durian cendol back',
    '❤️ Farah Aziz, 😋 Nurul Huda, 😋 kopilover',
  );
} else {
  await expectReactions('after restart: DM', PRIYA, 'The rider is 5 minutes away', '👍 Priya Nair');
  await expectReactions('after restart: removed', PRIYA, 'So sorry Priya', '(none)');
  await expectReactions('after restart: phone', PRIYA, 'Okay thank you', '🙏 phone');
  await expectReactions(
    'after restart: group',
    GROUP,
    'Is the durian cendol back',
    '❤️ Farah Aziz, 😋 Nurul Huda, 😋 kopilover',
  );
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
