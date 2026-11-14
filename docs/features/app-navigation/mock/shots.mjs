// Screenshots of the proposed app navigation (app-navigation) in the running seeded mock (run.ts --fake-wa):
// desktop 1280 px (icon rail) and phone 360 px (bottom tabs, touch), light and dark, en + ms + zh-CN, an admin
// (aisyah), a team member (daniel) and an agent limited to chosen chats (ravi). Covers Chats with the unread count,
// an open chat (no tabs on the phone), Reports, Ask Ezy (docked panel / full screen), Members, Settings (side menu
// on desktop, list on the phone), the red attention dot, the account menu and the Account page.
// Checks: page errors, horizontal overflow, rail only from 768 px, tabs only below it and never in an open chat,
// phone tab hit areas >= 44 px. Ends with ../screenshots/results.json.
// Usage: node docs/features/app-navigation/mock/shots.mjs [baseUrl]   (PW_CHROMIUM=<chromium>)
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7489';
const OUT = join(import.meta.dirname, '..', 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
const passed = [];
const sizes = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};
const PRIYA = '60128814455@s.whatsapp.net';

async function session(user, { size, scheme = 'light', locale = 'en', edition = 'enterprise' }) {
  const ctx = await browser.newContext({
    ...sizes[size],
    baseURL: BASE,
    colorScheme: scheme,
    timezoneId: 'Asia/Kuala_Lumpur',
  });
  await ctx.addInitScript(
    ([loc, ed]) => {
      localStorage.setItem('wati.locale', loc);
      localStorage.setItem('mock.customAgents.edition.v1', ed);
    },
    [locale, edition],
  );
  const login = await ctx.request.post('/api/auth/login', {
    data: { username: user, password: 'demo-pass-123' },
    headers: { origin: BASE },
  });
  if (!login.ok()) throw new Error(`login ${user} failed ${login.status()}`);
  const page = await ctx.newPage();
  page.setDefaultTimeout(12_000);
  const suffix = `${size === 'desktop' ? 'd1280' : 'm360'}-${scheme}${locale === 'en' ? '' : `-${locale}`}`;
  page.on('pageerror', (e) => problems.push(`${user} ${suffix} pageerror: ${e.message}`));
  /** Layout checks on every shot: overflow, which navigation shows, tab hit areas. */
  const check = async (name, { inChat = false, overlay = false } = {}) => {
    const r = await page.evaluate(() => {
      const visible = (el) => !!el && el.getBoundingClientRect().width > 0;
      const tabs = document.querySelector('[data-testid="app-tabs"]');
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        rail: visible(document.querySelector('[data-testid="app-rail"]')),
        tabs: visible(tabs),
        tabHeights: tabs
          ? [...tabs.querySelectorAll('a,button')].map((el) => {
              const b = el.getBoundingClientRect();
              return Math.min(b.width, b.height);
            })
          : [],
      };
    });
    const where = `${user} ${suffix} ${name}`;
    if (r.overflow) problems.push(`${where}: horizontal overflow`);
    if (size === 'desktop' && (!r.rail || r.tabs))
      problems.push(`${where}: desktop must show the rail only`);
    if (size === 'mobile' && r.rail) problems.push(`${where}: rail visible on the phone`);
    if (overlay) return;
    if (size === 'mobile' && inChat && r.tabs)
      problems.push(`${where}: tab bar inside an open chat`);
    if (size === 'mobile' && !inChat && !r.tabs) problems.push(`${where}: tab bar missing`);
    if (size === 'mobile' && r.tabHeights.some((h) => h < 44))
      problems.push(`${where}: tab hit area < 44 px (${r.tabHeights})`);
  };
  const shot = async (name, opts) => {
    await page.waitForTimeout(450);
    await check(name, opts);
    await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`) });
    passed.push(`${name}-${suffix}`);
  };
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      problems.push(`${user} ${suffix} ${name}: ${e.message.split('\n')[0]}`);
      await page.keyboard.press('Escape').catch(() => {});
    }
  };
  return { ctx, page, shot, step, size };
}

const navId = (size, id) => (size === 'desktop' ? `nav-${id}` : `tab-${id}`);
async function openList(page) {
  await page.goto('/');
  await page
    .locator('[data-testid="chat-list-item"], [data-chat-jid], li a[href^="/chats/"]')
    .first()
    .waitFor();
}
async function ask(s, question) {
  const { page, size } = s;
  await page.getByTestId(navId(size, 'ask-ezy')).click();
  const panel = page.getByTestId('ask-ezy-panel');
  await panel.waitFor();
  const box = panel.locator('textarea');
  await box.fill(question);
  await box.press('Enter');
  await panel.getByTestId('ask-ezy-answer').first().waitFor();
}

// ---- Admin, desktop -------------------------------------------------------------------------------------------
for (const scheme of ['light', 'dark']) {
  const s = await session('aisyah', { size: 'desktop', scheme });
  const { page, shot, step } = s;
  await step('chats', async () => {
    await openList(page);
    await shot('01-chats-unread');
  });
  await step('chat open', async () => {
    await page.goto(`/chats/${encodeURIComponent(PRIYA)}`);
    await page.locator('textarea').first().waitFor();
    await shot('02-chat-open', { inChat: true });
  });
  await step('reports', async () => {
    await page.getByTestId('nav-reports').click();
    await page.waitForURL(/\/admin\/reports/);
    await page.getByRole('heading').first().waitFor();
    await shot('03-reports');
  });
  await step('ask ezy', async () => {
    await ask(s, 'How is my inbox this week?');
    await shot('04-ask-ezy');
    await page.getByTestId('nav-ask-ezy').click();
  });
  if (scheme === 'dark') {
    await s.ctx.close();
    continue;
  }
  await step('members', async () => {
    await page.getByTestId('nav-members').click();
    await page.waitForURL(/\/admin\/members/);
    await page.getByRole('heading').first().waitFor();
    await shot('05-members');
  });
  await step('settings', async () => {
    await page.getByTestId('nav-settings').click();
    await page.waitForURL(/\/admin\/settings/);
    await page.getByTestId('settings-nav').waitFor();
    await shot('06-settings');
  });
  await step('attention', async () => {
    await page.goto('/admin/quick-replies?attention=1');
    await page.getByTestId('nav-attention-dot').first().waitFor();
    await shot('07-settings-attention');
    // The dot leads to the numbers page.
    await page.getByTestId('nav-settings').click();
    await page.waitForURL(/\/admin\/(inboxes|whatsapp)/);
    await shot('08-attention-numbers');
    await page.goto('/admin/quick-replies?attention=0');
  });
  await step('account menu', async () => {
    await openList(page);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menu').waitFor();
    await shot('09-account-menu');
    await page.keyboard.press('Escape');
  });
  await s.ctx.close();
}

// Long labels: Malay and Chinese rail.
for (const locale of ['ms', 'zh-CN']) {
  const s = await session('aisyah', { size: 'desktop', locale });
  await s.step('chats', async () => {
    await openList(s.page);
    await s.shot('01-chats-unread');
  });
  await s.step('settings', async () => {
    await s.page.goto('/admin/settings');
    await s.page.getByTestId('settings-nav').waitFor();
    await s.shot('06-settings');
  });
  await s.ctx.close();
}

// Team member and limited agent, desktop.
for (const user of ['daniel', 'ravi']) {
  const s = await session(user, { size: 'desktop' });
  await s.step('chats', async () => {
    await openList(s.page);
    await s.shot(`10-${user}-chats`);
  });
  if (user === 'daniel')
    await s.step('ask ezy', async () => {
      await ask(s, 'Which customers wait for a reply?');
      await s.shot(`11-${user}-ask-ezy`);
    });
  await s.ctx.close();
}

// ---- Admin, phone ---------------------------------------------------------------------------------------------
for (const scheme of ['light', 'dark']) {
  const s = await session('aisyah', { size: 'mobile', scheme });
  const { page, shot, step } = s;
  await step('chats', async () => {
    await openList(page);
    await shot('01-chats-unread');
  });
  await step('chat open', async () => {
    await page.goto(`/chats/${encodeURIComponent(PRIYA)}`);
    await page.locator('textarea').first().waitFor();
    await shot('02-chat-open', { inChat: true });
  });
  await step('reports', async () => {
    await page.goto('/');
    await page.getByTestId('tab-reports').click();
    await page.waitForURL(/\/admin\/reports/);
    await page.getByTestId('phone-bar').waitFor();
    await shot('03-reports');
  });
  await step('ask ezy', async () => {
    await ask(s, 'How is my inbox this week?');
    await shot('04-ask-ezy', { overlay: true });
    await page.keyboard.press('Escape');
  });
  await step('settings home', async () => {
    await page.goto('/admin/reports');
    await page.getByTestId('tab-settings').click();
    await page.getByTestId('settings-home').waitFor();
    await shot('12-settings-home');
  });
  if (scheme === 'dark') {
    await s.ctx.close();
    continue;
  }
  await step('settings attention', async () => {
    await page.goto('/admin?attention=1');
    await page.getByTestId('settings-home').waitFor();
    await shot('07-settings-attention');
    await page.goto('/admin?attention=0');
    await page.getByTestId('settings-home').waitFor();
  });
  await step('members', async () => {
    await page.getByTestId('settings-home').getByRole('link', { name: 'Members' }).click();
    await page.waitForURL(/\/admin\/members/);
    await shot('05-members');
  });
  await step('app settings', async () => {
    await page.goto('/admin');
    await page.getByTestId('settings-home').getByRole('link', { name: 'App settings' }).click();
    await page.waitForURL(/\/admin\/settings/);
    await shot('06-settings');
  });
  await step('account', async () => {
    await page.goto('/admin');
    await page
      .getByTestId('settings-home')
      .getByRole('link', { name: /Aisyah/ })
      .click();
    await page.getByTestId('account-page').waitFor();
    await shot('13-account');
  });
  await s.ctx.close();
}

for (const locale of ['ms', 'zh-CN']) {
  const s = await session('aisyah', { size: 'mobile', locale });
  await s.step('chats', async () => {
    await openList(s.page);
    await s.shot('01-chats-unread');
  });
  await s.step('settings home', async () => {
    await s.page.goto('/admin?attention=1');
    await s.page.getByTestId('settings-home').waitFor();
    await s.shot('12-settings-home');
  });
  await s.ctx.close();
}

// Team member (3 tabs) and limited agent (no Ask Ezy), phone.
for (const scheme of ['light', 'dark']) {
  const s = await session('daniel', { size: 'mobile', scheme });
  await s.step('chats', async () => {
    await openList(s.page);
    await s.shot('10-daniel-chats');
  });
  await s.step('account', async () => {
    await s.page.getByTestId('tab-account').click();
    await s.page.getByTestId('account-page').waitFor();
    await s.shot('14-daniel-account');
  });
  if (scheme === 'light')
    await s.step('ask ezy', async () => {
      await ask(s, 'Which customers wait for a reply?');
      await s.shot('11-daniel-ask-ezy', { overlay: true });
    });
  await s.ctx.close();
}
{
  const s = await session('ravi', { size: 'mobile' });
  await s.step('chats', async () => {
    await openList(s.page);
    await s.shot('10-ravi-chats');
  });
  await s.ctx.close();
}

await browser.close();
writeFileSync(
  join(OUT, 'results.json'),
  JSON.stringify({ ranAt: new Date().toISOString(), passed, failed: problems }, null, 2) + '\n',
);
console.log(`${passed.length} screenshots, ${problems.length} problems`);
for (const p of problems) console.log(' - ' + p);
