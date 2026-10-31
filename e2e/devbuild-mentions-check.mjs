// Dev Build check of tagging group members (docs/features/group-mentions/design.md) on a server
// started with `--mode dev --fake-wa` and the built web: the server refusals, a send with mentions
// (stored as `@<number>` + addresses, shown as names), and the composer picker in a real browser at
// desktop 1280 and phone 360, light and dark, with screenshots for the screen review.
// Usage: node e2e/devbuild-mentions-check.mjs <baseUrl> [screenshotDir]
// Never calls a model or a real WhatsApp number.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { apiClient, checker } from './devbuild-client.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:7431';
const inside = (base, path) => {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const repo = resolve(import.meta.dirname, '..');
const OUT = process.argv[3] ? resolve(repo, process.argv[3]) : null;
if (OUT && !inside(repo, OUT) && !inside(resolve(tmpdir()), OUT))
  throw new Error('The screenshot folder must be inside the repository or the temp folder.');
if (OUT) mkdirSync(OUT, { recursive: true });
const { check, finish } = checker();
const api = apiClient(BASE);
const enc = encodeURIComponent;

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json?.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);

const GROUP = '120363099990077@g.us';
const DM = '60111222333@s.whatsapp.net';
const FARAH = '60123110021@s.whatsapp.net';
const TAN = '269088374935676@lid';
await api('POST', '/dev/fake-group', {
  groupJid: GROUP,
  name: 'Kopi Lovers Club',
  generated: 12,
  members: [
    { phone: '60126677889', name: 'Nurul Huda', role: 'admin' },
    { phone: '60123110021', name: 'Farah Aziz' },
    { lid: '269088374935676', name: 'Tan Wei Jie' },
  ],
});
await api('POST', '/dev/fake-incoming', {
  chatJid: GROUP,
  senderJid: '60126677889@s.whatsapp.net',
  senderName: 'Nurul Huda',
  text: 'Do the new beans arrive Friday?',
});
await api('POST', '/dev/fake-incoming', { chatJid: DM, senderName: 'Lim', text: 'Hi' });

const inboxes = (await api('GET', '/inboxes')).json?.inboxes ?? [];
check(inboxes[0]?.capabilities?.mentions === true, 'the linked phone inbox can tag members');

const refuse = async (jid, body, step) => {
  const r = await api('POST', `/chats/${enc(jid)}/messages`, body);
  check(r.status === 400, step, `${r.status} ${r.json?.error?.message ?? ''}`);
};
await refuse(
  DM,
  { text: 'Hi @60123110021', clientId: 'dm-1', mentions: [FARAH] },
  'a direct chat refuses tags',
);
await refuse(
  GROUP,
  { text: 'Hi there', clientId: 'g-0', mentions: [FARAH] },
  'a tag missing from the text is refused',
);
await refuse(
  GROUP,
  { text: 'Hi @1', clientId: 'g-00', mentions: [GROUP] },
  'a group address is no member',
);

const text = 'Morning @60123110021 and @269088374935676, beans arrive Friday';
const sent = await api('POST', `/chats/${enc(GROUP)}/messages`, {
  text,
  clientId: 'devbuild-tag-1',
  mentions: [FARAH, TAN],
});
check(
  sent.status === 201 &&
    sent.json?.body === 'Morning @Farah Aziz and @Tan Wei Jie, beans arrive Friday',
  'a tagged send is accepted and shows the names',
  `${sent.status} ${sent.json?.body}`,
);
let status = '';
for (let i = 0; i < 50 && !['sent', 'delivered'].includes(status); i++) {
  await new Promise((r) => setTimeout(r, 100));
  const list = (await api('GET', `/chats/${enc(GROUP)}/messages`)).json?.messages ?? [];
  status = list.find((m) => m.clientId === 'devbuild-tag-1')?.status ?? '';
}
check(['sent', 'delivered'].includes(status), 'the fake WhatsApp sent it', status);

// The composer in a real browser.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const sizes = {
  desktop: { viewport: { width: 1280, height: 860 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};
for (const scheme of ['light', 'dark'])
  for (const [sizeName, size] of Object.entries(sizes)) {
    const suffix = `${sizeName}-${scheme}`;
    const ctx = await browser.newContext({ ...size, baseURL: BASE, colorScheme: scheme });
    await ctx.request.post('/api/auth/login', {
      data: { username: admin.username, password: admin.password },
      headers: { origin: BASE },
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name) => {
      const overflow = await page.evaluate(() => {
        const root = globalThis.document.documentElement;
        return root.scrollWidth > root.clientWidth + 1;
      });
      check(!overflow, `${suffix} ${name}: no horizontal scroll`);
      if (OUT) await page.screenshot({ path: join(OUT, `mention-${name}-${suffix}.png`) });
    };
    try {
      await page.goto(`/chats/${enc(GROUP)}`);
      const box = page.getByLabel('Message', { exact: true });
      await box.click();
      await box.pressSequentially('Morning @');
      const picker = page.getByTestId('mention-picker');
      await picker.waitFor();
      const count = await picker.getByRole('option').count();
      check(count === 15, `${suffix} the picker lists every member but the linked number`, count);
      await shot('picker');
      await box.pressSequentially('fa');
      await picker.getByRole('option', { name: /Farah Aziz/ }).click();
      await box.pressSequentially('and @tan');
      await page.keyboard.press('Tab');
      await box.pressSequentially('see you Friday');
      check(
        (await box.inputValue()) === 'Morning @Farah Aziz and @Tan Wei Jie see you Friday',
        `${suffix} the box shows the picked names`,
      );
      await shot('picked');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const bubble = page
        .getByRole('log', { name: 'Messages' })
        .getByText('Morning @Farah Aziz and @Tan Wei Jie see you Friday', { exact: true })
        .last();
      await bubble.waitFor();
      await page.waitForTimeout(800);
      await shot('sent');
      await page.goto(`/chats/${enc(DM)}`);
      const dmBox = page.getByLabel('Message', { exact: true });
      await dmBox.click();
      await dmBox.pressSequentially('Hi @fa');
      await page.waitForTimeout(300);
      check(
        (await page.getByTestId('mention-picker').count()) === 0,
        `${suffix} a direct chat has no picker`,
      );
    } catch (e) {
      check(false, `${suffix} composer flow`, e.message.split('\n')[0]);
    }
    check(errors.length === 0, `${suffix} no page errors`, errors.join(' | '));
    await ctx.close();
  }
await browser.close();
finish();
