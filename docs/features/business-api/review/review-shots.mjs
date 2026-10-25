// Dev Build / screen review check of the core Business API pieces (reply window, Send a template, chat-list
// icon, inbox card) on a dev server with the built-in `fake-api` inbox type. TEST ONLY: fake WhatsApp.
//   npm run build -w @ezychat/web
//   npx tsx --conditions=ezychat-source packages/server/src/cli.ts --data <tmp> --port 7493 --fake-wa \
//     --mode dev --max-inboxes 3 --web-dist apps/web/dist
//   node docs/features/business-api/review/review-shots.mjs [http://127.0.0.1:7493]
// Screenshots (1280/360, light/dark) land next to this file; prints page errors / horizontal scroll.
import { chromium } from '@playwright/test';
const BASE = process.argv[2] ?? 'http://127.0.0.1:7493';
const OUT = import.meta.dirname;
const b = await chromium.launch();
const problems = [];
const api = async (ctx, path, data) => {
  const r = await ctx.request.post(BASE + path, { data, headers: { origin: BASE } });
  if (!r.ok()) throw new Error(path + ' ' + r.status() + ' ' + (await r.text()));
  return r.json().catch(() => null);
};
const setup = await b.newContext();
await api(setup, '/api/setup/admin', {
  username: 'aisyah',
  displayName: 'Aisyah',
  password: 'demo-pass-123',
});
await api(setup, '/api/auth/login', { username: 'aisyah', password: 'demo-pass-123' });
const inbox = await api(setup, '/api/dev/fake-api-inbox', { name: 'Online orders' });
const open = '60128814455@s.whatsapp.net',
  closed = '60129001234@s.whatsapp.net';
await api(setup, '/api/dev/fake-incoming', {
  inboxId: inbox.id,
  chatJid: open,
  senderName: 'Priya Nair',
  text: 'My order #1042 has not arrived yet.',
});
await api(setup, '/api/dev/fake-incoming', {
  inboxId: inbox.id,
  chatJid: closed,
  senderName: 'Jason Lim',
  text: 'How much is a large Kopi Peng?',
});
await api(setup, '/api/dev/fake-incoming', {
  chatJid: '60127020388@s.whatsapp.net',
  senderName: 'Tan Wei Jie',
  text: 'Can you deliver to Gurney Drive?',
});
await api(setup, '/api/dev/fake-window', { chatJid: `${open}#${inbox.id}`, hoursAgo: 18 });
await api(setup, '/api/dev/fake-window', { chatJid: `${closed}#${inbox.id}`, hoursAgo: 30 });
const href = (j) => `/chats/${encodeURIComponent(`${j}#${inbox.id}`)}`;
const sizes = { desktop: { width: 1280, height: 860 }, mobile: { width: 360, height: 780 } };
async function shot(page, name) {
  await page.waitForTimeout(400);
  const o = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  if (o) problems.push(name + ': horizontal scroll');
  await page.screenshot({ path: `${OUT}/${name}.png` });
}
for (const scheme of ['light', 'dark'])
  for (const [sz, vp] of Object.entries(sizes)) {
    const s = `${sz}${scheme === 'dark' ? '-dark' : ''}`;
    const ctx = await b.newContext({ viewport: vp, colorScheme: scheme, baseURL: BASE });
    await api(ctx, '/api/auth/login', { username: 'aisyah', password: 'demo-pass-123' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => problems.push(s + ' ' + e.message));
    await p.goto(href(open));
    await p.getByText(/Reply window:/).waitFor();
    await shot(p, `chat-window-open-${s}`);
    await p.goto(href(closed));
    await p.getByText('The reply window has closed').waitFor();
    await shot(p, `chat-window-closed-${s}`);
    await p.getByRole('button', { name: 'Send a template' }).click();
    const d = p.getByRole('dialog');
    await d.getByRole('button', { name: /order_update/ }).click();
    await d.getByLabel('Variable 2').fill('A-1024');
    await shot(p, `template-dialog-${s}`);
    await p.keyboard.press('Escape');
    if (sz === 'desktop') {
      await p.goto('/');
      await p.getByText('Jason Lim').first().waitFor();
      await shot(p, `chat-list-${s}`);
    }
    await p.goto('/admin/inboxes');
    await p.getByText('Online orders').first().waitFor();
    await shot(p, `inboxes-${s}`);
    await ctx.close();
  }
// sent marker (once)
const ctx = await b.newContext({ viewport: sizes.desktop, baseURL: BASE });
await api(ctx, '/api/auth/login', { username: 'aisyah', password: 'demo-pass-123' });
const p = await ctx.newPage();
await p.goto(href(closed));
await p.getByRole('button', { name: 'Send a template' }).click();
const d = p.getByRole('dialog');
await d.getByRole('button', { name: /order_update/ }).click();
await d.getByLabel('Variable 2').fill('A-1024');
await d.getByRole('button', { name: 'Send template' }).click();
await p
  .getByLabel('Messages')
  .getByText(/Template order_update/)
  .waitFor();
await shot(p, 'template-sent-desktop');
await b.close();
console.log(problems.length ? problems.join('\n') : 'no problems');
