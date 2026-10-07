// Marketing screenshot library: seeds a fresh fake-WhatsApp server with demo data (the fictional
// "Kopi Apong" coffee shop) and saves screenshots per module into docs/screenshots/<module>/.
// Usage (fresh data dir, never the real app data):
//   npm run build -w @wa-team-inbox/web
//   npx tsx packages/server/src/cli.ts --data <tmp> --port 7477 --fake-wa --mode standalone --web-dist apps/web/dist
//   node e2e/marketing-screenshots.mjs 7477 docs/screenshots
// `--mode standalone` keeps the "Dev Build" badge out of the shots. Nothing is sent to real WhatsApp.
/* global window -- used inside addInitScript (runs in the browser) */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Only a port is accepted: the script seeds data and logs in, so it must only ever talk to a local demo server.
const PORT = Number.parseInt(process.argv[2] ?? '7477', 10);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535)
  throw new Error('Usage: node e2e/marketing-screenshots.mjs <port> [outDir]');
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.argv[3] ?? 'docs/screenshots';
const PASSWORD = 'demo-pass-123';
const OWNER = { username: 'aisyah', displayName: 'Aisyah', password: PASSWORD };
const TEAM = [
  { username: 'daniel', displayName: 'Daniel', role: 'agent' },
  { username: 'meiling', displayName: 'Mei Ling', role: 'agent' },
];
const jid = (n) => `6012${n}@s.whatsapp.net`;

async function session(username, password = PASSWORD) {
  const headers = { 'content-type': 'application/json', origin: BASE };
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login ${username}: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const call = async (method, path, body) => {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: body === undefined ? { origin: BASE, cookie } : { ...headers, cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return r.json().catch(() => null);
  };
  return { cookie, call };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let clientSeq = 0;
const say = (s, chat, text, senderName) =>
  s.call('POST', '/dev/fake-incoming', { chatJid: chat, senderName, text });
const reply = (s, chat, text) =>
  s.call('POST', `/chats/${encodeURIComponent(chat)}/messages`, {
    text,
    clientId: `demo-${++clientSeq}`,
  });

async function seed() {
  const setup = await fetch(`${BASE}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify(OWNER),
  });
  if (!setup.ok)
    throw new Error(`setup: ${setup.status} ${await setup.text()} (use a fresh --data dir)`);
  const owner = await session(OWNER.username);
  const team = {};
  for (const m of TEAM) {
    const temp = `${PASSWORD}-tmp`;
    await owner.call('POST', '/users', { ...m, password: temp });
    const s = await session(m.username, temp);
    await s.call('POST', '/auth/change-password', { currentPassword: temp, newPassword: PASSWORD });
    team[m.username] = await session(m.username);
  }

  for (const [shortcut, body] of [
    ['hours', 'We are open daily 8am–10pm. Kitchen closes at 9.30pm.'],
    ['menu', 'Here is our menu: https://kopiapong.example/menu ☕'],
    ['delivery', 'We deliver within 5 km of Georgetown. Free delivery above RM40.'],
  ])
    await owner.call('POST', '/quick-replies', { shortcut, body });
  // A placeholder key only fills the connection form; the AI member stays off, so no model is ever called.
  await owner.call('PATCH', '/ai/connection', {
    mode: 'api',
    model: '',
    apiKey: 'sk-demo-placeholder-not-a-key',
  });
  const ai = await owner.call('GET', '/ai');
  await owner.call('PUT', '/ai', {
    displayName: 'Kopi Apong AI',
    enabled: false,
    instructions: ai.settings.instructions,
    handoffRules: ai.settings.handoffRules,
  });
  await owner.call('POST', '/ai/documents/text', {
    name: 'Menu and prices',
    text: 'Kopi O RM3.50 · Kopi Peng RM4.50 · Teh Tarik RM4 · Nasi Lemak Ayam RM12 · Roti Bakar Kaya RM5.\nCatering trays for 20 pax from RM180, order 2 days ahead.',
  });
  await owner.call('POST', '/ai/documents/text', {
    name: 'Opening hours and delivery',
    text: 'Open daily 8am to 10pm. Delivery within 5 km of Georgetown, free above RM40. Pickup at 12 Lebuh Chulia.',
  });

  const [d, m] = [team.daniel, team.meiling];
  // Chats arrive in this order; the last one ends up on top of the inbox.
  await say(
    owner,
    jid('3110021'),
    'Hi, can I book catering for 30 people this Saturday?',
    'Farah Catering Co',
  );
  await pause(300);
  await reply(m, jid('3110021'), 'Hi Farah! Yes, Saturday is available. Lunch or dinner?');
  await say(owner, jid('3110021'), 'Lunch, around 12pm. Halal please 🙏', 'Farah Catering Co');
  await m.call('POST', `/chats/${encodeURIComponent(jid('3110021'))}/notes`, {
    body: 'Repeat customer — gave 10% discount last time. Confirm deposit before Thursday.',
  });

  await say(owner, jid('5550142'), 'Is the shop open on Hari Raya?', 'Ahmad Zulkifli');
  await pause(300);
  await reply(d, jid('5550142'), 'Selamat Hari Raya! We open 11am–6pm on the first day.');
  await say(owner, jid('5550142'), 'Terima kasih! 👍', 'Ahmad Zulkifli');
  await owner.call('PATCH', `/chats/${encodeURIComponent(jid('5550142'))}`, { status: 'resolved' });

  await say(owner, jid('7020388'), '你好，请问可以送到 Gurney Drive 吗？', 'Tan Wei Jie');
  await pause(300);
  await reply(m, jid('7020388'), '可以的！Gurney Drive 在我们的送货范围内，满 RM40 免运费。');

  await say(
    owner,
    jid('8814455'),
    'My order #1042 hasn’t arrived yet, it’s been an hour',
    'Priya Nair',
  );
  await pause(300);
  await reply(d, jid('8814455'), 'So sorry Priya! Let me check with the rider now.');
  await reply(
    d,
    jid('8814455'),
    'The rider is 5 minutes away. I’ve added a free Teh Tarik to your next order ☕',
  );
  await say(owner, jid('8814455'), 'Okay thank you, that’s nice of you', 'Priya Nair');

  await say(owner, jid('9001234'), 'Hello! How much is a large Kopi Peng?', 'Jason Lim');
  await pause(300);
  await say(owner, jid('9001234'), 'And do you have oat milk?', 'Jason Lim');
  await say(owner, jid('6677889'), 'Can I order 2 Nasi Lemak for pickup at 1pm?', 'Nurul Huda');
  await pause(300);
  await reply(d, jid('6677889'), 'Sure Nurul! 2 Nasi Lemak Ayam, ready at 1pm. Total RM24.');
  await say(owner, jid('6677889'), 'Perfect, see you then!', 'Nurul Huda');
  // Customer profiles (lead info): a filled profile and a tagged repeat customer.
  await owner.call('PUT', `/chats/${encodeURIComponent(jid('3110021'))}/profile`, {
    name: 'Farah Aziz',
    company: 'Farah Catering Co',
    email: 'orders@farahcatering.example',
    otherPhone: '',
    address: 'Georgetown, Penang',
    tags: ['VIP', 'Catering'],
  });
  await owner.call('PUT', `/chats/${encodeURIComponent(jid('8814455'))}/profile`, {
    name: '',
    company: '',
    email: '',
    otherPhone: '',
    address: '',
    tags: ['Repeat'],
  });
  await pause(500);
  return owner;
}

const SHOTS = [
  // [module, file, path, viewports]
  ['inbox', 'inbox', '/', ['desktop', 'mobile']],
  ['chat', 'conversation', `/chats/${encodeURIComponent(jid('8814455'))}`, ['desktop', 'mobile']],
  ['chat', 'conversation-notes', `/chats/${encodeURIComponent(jid('3110021'))}`, ['desktop']],
  [
    'chat',
    'customer',
    `/chats/${encodeURIComponent(jid('3110021'))}?customer=1`,
    ['desktop', 'mobile'],
  ],
  ['chat', 'conversation-chinese', `/chats/${encodeURIComponent(jid('7020388'))}`, ['mobile']],
  ['admin-members', 'members', '/admin/members', ['desktop', 'mobile']],
  ['ai-member', 'ai-member', '/admin/members/ai', ['desktop', 'mobile']],
  ['ai-settings', 'ai-connection', '/admin/settings/ai', ['desktop']],
  ['quick-replies', 'quick-replies', '/admin/quick-replies', ['desktop']],
  ['whatsapp-link', 'whatsapp', '/admin/whatsapp', ['desktop']],
  ['remote-access', 'remote-access', '/admin/tunnel', ['desktop']],
  ['settings', 'settings', '/admin/settings', ['desktop']],
];
// Dark variants only where marketing uses them, to keep the repository small.
const DARK = new Set(['inbox', 'conversation']);
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 360, height: 780 } };

const owner = await seed();
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
for (const theme of ['light', 'dark']) {
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({
      viewport: size,
      baseURL: BASE,
      colorScheme: theme,
      deviceScaleFactor: 2,
    });
    await ctx.addCookies(
      owner.cookie.split('; ').map((c) => {
        const [name, ...v] = c.split('=');
        return { name, value: v.join('='), url: BASE };
      }),
    );
    await ctx.addInitScript(() => window.localStorage.setItem('wati.locale', 'en'));
    const page = await ctx.newPage();
    for (const [module, file, path, vps] of SHOTS) {
      if (!vps.includes(vp) || (theme === 'dark' && !DARK.has(file))) continue;
      mkdirSync(join(OUT, module), { recursive: true });
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(800);
      const name = `${file}-${vp}${theme === 'dark' ? '-dark' : ''}.png`;
      await page.screenshot({ path: join(OUT, module, name) });
      console.log(`${module}/${name}`);
    }
    await ctx.close();
  }
}
await browser.close();
