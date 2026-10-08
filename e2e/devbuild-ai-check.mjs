// Real-model AI check on a Dev Build seeded by marketing-screenshots.mjs (fake WhatsApp, demo data).
// Usage:
//   node e2e/devbuild-ai-check.mjs <port> prep            unassign Farah's chat + add a delivery fact
//   node e2e/devbuild-ai-check.mjs <port> send ["text"]   send a fake customer message from Farah
//   node e2e/devbuild-ai-check.mjs <port> new <digits> "text" [profile]
//       a message from a fresh number (no earlier hand-off); `profile` saves demo details right away
//   node e2e/devbuild-ai-check.mjs <port> long <digits>
//       a 24-message chat whose first message holds an order number, then an unassigned question
//       about it: the AI must read older messages to answer
// The owner signs in to the AI and turns the AI member on in between; `send`/`new` make real model
// calls. Record every run in docs/dev-build-checks.md.
const [port, command = 'prep', ...rest] = process.argv.slice(2);
if (!/^\d+$/.test(port ?? '') || !['prep', 'send', 'new', 'long'].includes(command))
  throw new Error('Usage: node e2e/devbuild-ai-check.mjs <port> prep|send|new|long …');
const BASE = `http://127.0.0.1:${port}`;
const FARAH = '60123110021@s.whatsapp.net';

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE },
  body: JSON.stringify({ username: 'aisyah', password: 'demo-pass-123' }),
});
if (!login.ok) throw new Error(`login: ${login.status} (seed the Dev Build first)`);
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');

async function call(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: BASE, cookie },
    body: JSON.stringify(body),
  });
  console.log(method, path, res.status);
  if (!res.ok) throw new Error(await res.text());
}

if (command === 'prep') {
  // Demo chats all belong to teammates; the AI only claims unassigned chats and needs knowledge.
  await call('PATCH', `/chats/${encodeURIComponent(FARAH)}`, { assignedTo: null });
  await call('POST', '/ai/documents/text', {
    name: 'Delivery',
    text:
      'We deliver catering trays across Penang island and Seberang Perai. Delivery fee RM15 per ' +
      'order, free above RM300. Orders need 2 days notice. Payment by bank transfer or DuitNow.',
  });
} else if (command === 'send') {
  await call('POST', '/dev/fake-incoming', {
    chatJid: FARAH,
    senderName: 'Farah Aziz',
    text: rest[0] ?? 'Hi, can you deliver 3 trays of nasi lemak to me this Saturday?',
  });
} else if (command === 'new') {
  const [digits, message, profile] = rest;
  if (!/^\d{6,15}$/.test(digits ?? '') || !message)
    throw new Error('new <digits> "text" [profile]');
  const chatJid = `${digits}@s.whatsapp.net`;
  await call('POST', '/dev/fake-incoming', { chatJid, senderName: 'Customer', text: message });
  // The AI claims after ~10 s, so details saved now are in its first prompt.
  if (profile === 'profile')
    await call('PUT', `/chats/${encodeURIComponent(chatJid)}/profile`, {
      name: 'Aminah Yusof',
      company: 'Aminah Bakes',
      email: 'aminah@aminahbakes.example',
      otherPhone: '',
      address: 'Bayan Lepas, Penang',
      tags: ['VIP', 'Late payer'],
    });
} else if (command === 'long') {
  const [digits] = rest;
  if (!/^\d{6,15}$/.test(digits ?? '')) throw new Error('long <digits>');
  const chatJid = `${digits}@s.whatsapp.net`;
  const path = `/chats/${encodeURIComponent(chatJid)}`;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const customer = (text) =>
    call('POST', '/dev/fake-incoming', { chatJid, senderName: 'Customer', text });
  // A teammate replying keeps the chat with them, so the AI stays out until it is unassigned.
  let seq = 0;
  const teammate = (text) =>
    call('POST', `${path}/messages`, { text, clientId: `long-${digits}-${++seq}` });
  await customer('Hi, I placed an order yesterday, my order number is 4521.');
  await pause(300);
  await teammate('Thanks! I have noted order 4521.');
  for (let i = 1; i <= 11; i++) {
    await pause(300);
    await customer(`Also, question ${i} about the menu.`);
    await pause(300);
    await teammate(`Sure, answer ${i}.`);
  }
  await pause(300);
  await call('PATCH', path, { assignedTo: null });
  await pause(300);
  await customer('Sorry, what was my order number again?');
}
