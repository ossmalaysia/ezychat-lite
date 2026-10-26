// Screenshots of the proposed Google Calendar connector (google-calendar) in the running seeded mock
// (run.ts --fake-wa), at desktop 1280 px and mobile 360 px (touch), light and dark: Settings →
// Integrations (connected, not connected, Google sign-in, sign-in expired, Google unavailable), the
// agent page Bookings card (connected, booking off, not connected), Try it (free times, would book,
// booking off) and the chat with the "AI booked" line. Reports page errors and horizontal overflow.
// Usage: node docs/features/google-calendar/mock/calendar-shots.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7489';
const OUT = join(import.meta.dirname, 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium
  .launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
  .catch(() => chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' }));
const problems = [];
const MEI_YING = '60124448899@s.whatsapp.net';
const post = (ctx, path, data, method = 'post') =>
  ctx.request[method](path, { data, headers: { origin: BASE } });

const sizes = {
  desktop: { viewport: { width: 1280, height: 860 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};
const BOOKING = {
  calendarId: 'bookings',
  checkFree: true,
  book: true,
  title: 'Table booking',
  lengthMin: 90,
  days: [1, 2, 3, 4, 5, 6],
  from: '10:00',
  to: '21:00',
  gapMin: 15,
  noticeHours: 2,
  maxDays: 14,
};

for (const scheme of ['light', 'dark'])
  for (const [sizeName, size] of Object.entries(sizes)) {
    const suffix = `${sizeName}-${scheme}`;
    const ctx = await browser.newContext({
      ...size,
      baseURL: BASE,
      colorScheme: scheme,
      timezoneId: 'Asia/Kuala_Lumpur',
    });
    const login = await post(ctx, '/api/auth/login', {
      username: 'aisyah',
      password: 'demo-pass-123',
    });
    if (!login.ok()) throw new Error(`login failed ${login.status()}`);
    const reset = async (state = 'connected', booking = BOOKING) => {
      await post(ctx, '/api/mock/google-calendar/connect', {
        account: 'kopiapong.penang@gmail.com',
      });
      await post(ctx, '/api/mock/google-calendar/state', { state }, 'put');
      await post(ctx, '/api/mock/google-calendar/agents/a1', booking, 'put');
    };
    await reset();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${suffix} pageerror: ${e.message}`));
    const shot = async (name, opts = {}) => {
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      if (overflow) problems.push(`${suffix} ${name}: horizontal overflow`);
      await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`), ...opts });
    };
    const settings = async () => {
      await page.goto('/admin/settings/integrations');
      await page.getByTestId('google-calendar-settings').waitFor();
    };
    const agentPage = async () => {
      await page.goto('/admin/members/ai/a1');
      const card = page.getByTestId('agent-bookings');
      await card.waitFor();
      await card.scrollIntoViewIfNeeded();
      return card;
    };

    // Settings → Integrations.
    await settings();
    await shot('01-settings-connected', { fullPage: true });
    await post(ctx, '/api/mock/google-calendar/state', { state: 'expired' }, 'put');
    await settings();
    await shot('02-settings-expired');
    await post(ctx, '/api/mock/google-calendar/state', { state: 'unavailable' }, 'put');
    await settings();
    await shot('03-settings-unavailable');
    await post(ctx, '/api/mock/google-calendar/disconnect', {});
    await settings();
    await shot('04-settings-not-connected');
    await page.getByRole('button', { name: 'Connect Google Calendar' }).click();
    await page.getByTestId('google-consent').waitFor();
    await shot('05-google-sign-in');
    await page.keyboard.press('Escape');

    // Agent page → Bookings.
    await agentPage();
    await shot('06-agent-not-connected');
    await reset('connected', { ...BOOKING, book: false });
    const card = await agentPage();
    await card.screenshot({ path: join(OUT, `07-agent-bookings-${suffix}.png`) });

    // Try it: free times, then booking off (team books).
    const tryIt = async (pick) => {
      await page.goto('/admin/members/ai/a1');
      const box = page.getByTestId('agent-try');
      await box.waitFor();
      await box.getByRole('textbox').fill('Hi, can I book a table for 4 people?');
      await box.getByRole('button', { name: 'Ask' }).click();
      await box.getByText('AI checked free times').waitFor();
      if (pick) await box.getByRole('button', { name: 'Customer picks the first time' }).click();
      await box.scrollIntoViewIfNeeded();
      return box;
    };
    await tryIt(false);
    await shot('08-try-free-times');
    await tryIt(true);
    await shot('09-try-booking-off-handoff');
    await reset();
    await tryIt(true);
    await page.getByTestId('try-would-book').waitFor();
    await shot('10-try-would-book');

    // The chat where the AI booked a table.
    await page.goto(`/chats/${encodeURIComponent(MEI_YING)}`);
    await page
      .getByText(/AI booked/)
      .first()
      .waitFor();
    await shot('11-chat-booked');
    await ctx.close();
  }
await browser.close();
console.log(problems.length ? problems.join('\n') : 'No page errors or horizontal overflow.');
