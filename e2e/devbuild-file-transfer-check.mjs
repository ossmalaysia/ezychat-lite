// Dev Build check for file transfer: drop and paste files into a chat, send them, copy a message out.
// Runs against a server that `screens.smoke.mjs` has already set up (its admin and demo chat):
//   node e2e/devbuild-file-transfer-check.mjs http://127.0.0.1:7432
/* global DataTransfer, ClipboardEvent, DragEvent -- used inside page.evaluate (browser) */
import { chromium } from '@playwright/test';
import { SMOKE_ADMIN as ADMIN, SMOKE_CHAT as CHAT } from './screen-routes.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:7432';
const PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: BASE });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const step = (name) => console.log(`PASS  ${name}`);
const fail = async (name, detail) => {
  console.log(`FAIL  ${name}: ${detail}`);
  await browser.close();
  process.exit(1);
};

const headers = { origin: BASE };
const login = await page.request.post('/api/auth/login', {
  data: { username: ADMIN.username, password: ADMIN.password },
  headers,
});
if (!login.ok()) await fail('login', login.status());
await page.request.post('/api/dev/fake-incoming', {
  data: { chatJid: CHAT, text: 'Can you send the price list?', senderName: 'Customer' },
  headers,
});
await page.goto(`/chats/${encodeURIComponent(CHAT)}`);
const composer = page.getByLabel('Message', { exact: true });
await composer.waitFor();

async function sendFiles(target, kind, files) {
  await target.evaluate(
    (el, { kind, files }) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const data = f.base64 ? Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)) : f.text;
        dt.items.add(new File([data], f.name, { type: f.type }));
      }
      if (kind === 'paste') {
        el.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
        return;
      }
      for (const type of ['dragenter', 'dragover', 'drop'])
        el.dispatchEvent(
          new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
    },
    { kind, files },
  );
}

const tray = page.getByTestId('attachment-tray');
// The smoke gives this chat a long CJK profile name: drop on the message list, which bubbles to the zone.
await sendFiles(page.getByRole('log', { name: 'Messages' }), 'drop', [
  { name: 'price-list.pdf', type: 'application/pdf', text: '%PDF-1.4 price list' },
]);
await tray
  .getByText('1 file to send')
  .waitFor({ timeout: 5000 })
  .catch(() => fail('drop', 'no tray'));
step('drop a PDF on the chat → tray shows 1 file');

await sendFiles(composer, 'paste', [{ name: 'image.png', type: 'image/png', base64: PIXEL_PNG }]);
await tray
  .getByText('2 files to send')
  .waitFor({ timeout: 5000 })
  .catch(() => fail('paste', 'no 2nd file'));
step('paste a screenshot → tray shows 2 files');

await composer.fill('Here you go');
await page.getByRole('button', { name: 'Send', exact: true }).click();
await tray.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => fail('send', 'tray stays'));
let sent = [];
for (let i = 0; i < 20 && sent.length < 2; i++) {
  const res = await page.request.get(`/api/chats/${encodeURIComponent(CHAT)}/messages`);
  sent = (await res.json()).messages.filter((m) => m.fromMe && m.mediaName);
  if (sent.length < 2) await page.waitForTimeout(500);
}
const order = sent.map((m) => `${m.mediaName}|${m.body ?? ''}`);
if (
  order.length !== 2 ||
  order[0] !== 'price-list.pdf|Here you go' ||
  !/^pasted-.*\.png\|$/.test(order[1])
)
  await fail('send', JSON.stringify(order));
step(`send → stored in order with the caption on the first: ${order.join(', ')}`);

const incoming = page
  .locator('[data-message-id]', { hasText: 'Can you send the price list?' })
  .first();
await incoming.hover();
await incoming.locator('..').getByRole('button', { name: 'Copy text' }).click();
const copied = await page.evaluate(() => navigator.clipboard.readText());
if (copied !== 'Can you send the price list?') await fail('copy', copied);
step('hover Copy text → clipboard holds the customer text');

if (errors.length) await fail('page errors', errors.join('; '));
step('no page errors');
await browser.close();
