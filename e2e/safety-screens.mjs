// WhatsApp Safety screen review shots against a running server with fake WhatsApp (demo data only):
// the chat warning (admin, and the file locked for an agent), Admin → Safety (list, details, report
// dialog, blocked, settings) and Admin → Reports → WhatsApp Safety, at 1280 px and 360 px, light and
// dark. Reports page errors and horizontal overflow; writes PNGs and safety-screens.json to <outDir>.
// Usage: node e2e/safety-screens.mjs <baseUrl> <outDir>   (PW_CHROMIUM=<chrome> when needed)
/* global document -- used inside page.evaluate (runs in the browser) */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:7488';
// Screenshots go only to a folder inside this checkout (never an absolute or ../ path).
const OUT = resolve(process.argv[3] ?? 'docs/screenshots/safety');
const inside = relative(process.cwd(), OUT);
if (!inside || inside.startsWith('..') || isAbsolute(inside))
  throw new Error('The output folder must be inside the current folder.');
mkdirSync(OUT, { recursive: true });
const H = { origin: BASE };
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);

function zip(inside) {
  const name = Buffer.from(inside, 'latin1');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(name.length, 28);
  const dir = Buffer.concat([central, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(30 + name.length, 16);
  return Buffer.concat([local, name, dir, eocd]);
}

// ---- demo data ----
const seed = await browser.newContext({ baseURL: BASE });
const r = seed.request;
const ok = async (pending) => {
  const res = await pending;
  if (!res.ok()) throw new Error(`${res.url()} ${res.status()} ${await res.text()}`);
  return res.json().catch(() => null);
};
await r.post('/api/setup/admin', {
  data: { username: 'aisyah', displayName: 'Aisyah', password: 'demo-pass-123' },
  headers: H,
});
await ok(
  await r.post('/api/auth/login', {
    data: { username: 'aisyah', password: 'demo-pass-123' },
    headers: H,
  }),
);
const incoming = (data) => ok(r.post('/api/dev/fake-incoming', { headers: H, data }));
const LURE = '601123456789@s.whatsapp.net';
const KNOWN = '60129001234@s.whatsapp.net';
await incoming({ chatJid: KNOWN, senderName: 'Jason Lim', text: 'How much is a large Kopi Peng?' });
await ok(
  r.post(`/api/chats/${encodeURIComponent(KNOWN)}/messages`, {
    headers: H,
    data: { text: 'RM6.50. Anything else?', clientId: 'seed-1' },
  }),
);
await incoming({
  chatJid: '60128814455@s.whatsapp.net',
  senderName: 'Priya Nair',
  text: 'Updated order list for next week attached.',
  type: 'document',
  media: {
    mime: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    fileName: 'Order_list_Nov.xlsm',
    base64: Buffer.from('x').toString('base64'),
  },
});
await incoming({
  chatJid: '60198887766@s.whatsapp.net',
  senderName: 'Maybank2u',
  text: 'Maybank2u: Your account is suspended. Verify within 24 hours at https://maybank2u-secure.my-verify.top/login to avoid urgent payment charges.',
});
await incoming({
  chatJid: KNOWN,
  senderName: 'Jason Lim',
  text: 'Hi boss, payment slip attached. Please check urgently.',
  type: 'document',
  media: {
    mime: 'application/zip',
    fileName: 'Payment_Slip.zip',
    base64: zip('Payment_Slip.pdf.js').toString('base64'),
  },
});
await incoming({
  chatJid: LURE,
  senderName: 'Accounts Dept',
  text: 'Good afternoon. Please forward this statement of account to your finance manager for review. Kindly open it on a laptop or desktop.',
  type: 'document',
  media: {
    mime: 'application/zip',
    fileName: 'Statement_of_Account_Oct2026.zip',
    base64: zip('Statement_of_Account_Oct2026.pdf.vbs').toString('base64'),
  },
});
const agentUser = await ok(
  r.post('/api/users', {
    headers: H,
    data: { username: 'daniel', displayName: 'Daniel', role: 'agent', password: 'demo-pass-123' },
  }),
);
const agentCtx = await browser.newContext({ baseURL: BASE });
await ok(
  await agentCtx.request.post('/api/auth/login', {
    data: { username: 'daniel', password: 'demo-pass-123' },
    headers: H,
  }),
);
await agentCtx.request.post('/api/auth/change-password', {
  data: { currentPassword: 'demo-pass-123', newPassword: 'demo-pass-456' },
  headers: H,
});
// Daniel tries the locked file (refused, recorded); Aisyah reports one number and blocks it.
const lureId = (await ok(r.get('/api/safety'))).items.find((i) => i.chatJid === LURE);
await agentCtx.request.get(`/api/media/${encodeURIComponent(lureId.messageId)}`);
const phishing = (await ok(r.get('/api/safety'))).items.find((i) => i.senderName === 'Maybank2u');
await ok(r.post(`/api/safety/items/${phishing.id}/report`, { headers: H, data: { block: true } }));
await agentCtx.close();
void agentUser;

// ---- shots ----
const problems = [];
const shots = [];
const sizes = {
  desktop: { viewport: { width: 1280, height: 860 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};
async function as(user, size, scheme) {
  const ctx = await browser.newContext({ ...size, baseURL: BASE, colorScheme: scheme });
  const password = user === 'aisyah' ? 'demo-pass-123' : 'demo-pass-456';
  const login = await ctx.request.post('/api/auth/login', {
    data: { username: user, password },
    headers: H,
  });
  if (!login.ok()) throw new Error(`login ${user} ${login.status()}`);
  const page = await ctx.newPage();
  return { ctx, page };
}
async function shot(page, name, suffix, run, target) {
  page.removeAllListeners('pageerror');
  page.on('pageerror', (e) => problems.push(`${name}-${suffix} pageerror: ${e.message}`));
  try {
    await run();
  } catch (e) {
    problems.push(`${name}-${suffix}: ${String(e.message).split('\n')[0]}`);
    return;
  }
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  if (overflow) problems.push(`${name}-${suffix}: horizontal overflow`);
  const path = join(OUT, `${name}-${suffix}.png`);
  if (target) await target().screenshot({ path });
  else await page.screenshot({ path });
  shots.push(`${name}-${suffix}`);
}

for (const scheme of ['light', 'dark'])
  for (const [sizeName, size] of Object.entries(sizes)) {
    const s = `${sizeName}-${scheme}`;
    const { ctx, page } = await as('aisyah', size, scheme);
    await shot(page, 'chat-zip-admin', s, async () => {
      await page.goto(`/chats/${encodeURIComponent(LURE)}`);
      await page.getByTestId('safety-notice').waitFor();
    });
    await shot(page, 'chat-zip-download', s, async () => {
      await page.getByTestId('safety-file').click();
      await page.getByTestId('safety-download-dialog').waitFor();
    });
    await page.keyboard.press('Escape');
    await shot(page, 'chat-hacked', s, async () => {
      await page.goto(`/chats/${encodeURIComponent(KNOWN)}`);
      await page.getByTestId('safety-chat-bar').waitFor();
    });
    await shot(page, 'chat-blocked', s, async () => {
      await page.goto(`/chats/${encodeURIComponent('60198887766@s.whatsapp.net')}`);
      await page.getByTestId('safety-chat-bar').waitFor();
    });
    await shot(page, 'safety-list', s, async () => {
      await page.goto('/admin/safety');
      await page.getByTestId('safety-row').first().waitFor();
    });
    await shot(page, 'safety-item', s, async () => {
      await page.getByTestId('safety-row').filter({ hasText: 'Accounts Dept' }).click();
      await page.getByTestId('safety-sheet').waitFor();
    });
    await shot(page, 'safety-report', s, async () => {
      await page.getByTestId('safety-report').click();
      await page.getByTestId('safety-report-dialog').waitFor();
    });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByTestId('safety-sheet').getByRole('button', { name: 'Close' }).click();
    await shot(page, 'safety-blocked', s, async () => {
      await page.getByRole('tab', { name: 'Blocked' }).click();
      await page.getByTestId('safety-blocked').waitFor();
    });
    await shot(page, 'safety-settings', s, async () => {
      await page.getByRole('tab', { name: 'Settings' }).click();
      await page.getByTestId('safety-settings').waitFor();
    });
    await shot(
      page,
      'reports-safety',
      s,
      async () => {
        await page.goto('/admin/reports');
        const section = page.getByTestId('report-safety');
        await section.waitFor();
        await section.scrollIntoViewIfNeeded();
      },
      () => page.getByTestId('report-safety'),
    );
    await ctx.close();
    const agent = await as('daniel', size, scheme);
    await shot(agent.page, 'chat-zip-agent', s, async () => {
      await agent.page.goto(`/chats/${encodeURIComponent(LURE)}`);
      const file = agent.page.getByTestId('safety-file');
      await file.waitFor();
      if ((await file.getAttribute('data-locked')) !== 'true')
        throw new Error('not locked for the agent');
      await file.click();
      await agent.page.getByText('This file is locked').waitFor();
    });
    await agent.ctx.close();
  }
await browser.close();
writeFileSync(join(OUT, 'safety-screens.json'), JSON.stringify({ shots, problems }, null, 2));
console.log(`${shots.length} shots, ${problems.length} problems`);
for (const p of problems) console.log(' -', p);
