// App navigation (docs/features/app-navigation/design.md): the rail from 768 px, the bottom tabs below, per role.
// Runs in every project: desktop Chromium shows the rail, the phone projects the tabs.
import type { Browser, Page } from '@playwright/test';
import {
  chatHref,
  chatItem,
  customerJid,
  expect,
  expectNoHorizontalScroll,
  fakeIncoming,
  inboxHeading,
  projectTag,
  signIn,
  test,
} from './helpers';

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;

/** The destinations of the visible bar, in order (the account photo of the rail is not one). */
async function places(page: Page): Promise<string[]> {
  const bar = page.getByTestId(isDesktop(page) ? 'app-rail' : 'app-tabs');
  await expect(bar).toBeVisible();
  return bar
    .locator('a[data-testid], button[data-testid]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''));
}

async function unreadOnServer(page: Page): Promise<number> {
  return ((await (await page.request.get('/api/chats/unread-count')).json()) as { count: number })
    .count;
}

/** A team member in a fresh browser context (the admin's shared session stays signed in). */
async function signInAsAgent(browser: Browser, page: Page, baseURL: string, tag: string) {
  const username = `nav${tag}${String(Date.now()).slice(-6)}`;
  const created = await page.request.post('/api/users', {
    headers: { Origin: baseURL },
    data: { username, displayName: `Nav agent ${tag}`, role: 'agent', password: 'temp-pass-123' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const context = await browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
    storageState: { cookies: [], origins: [] },
  });
  const agent = await context.newPage();
  await signIn(agent, username, 'temp-pass-123');
  // A member made with a temporary password must replace it first.
  await expect(agent.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await agent.getByLabel('Current password').fill('temp-pass-123');
  await agent.getByLabel('New password', { exact: true }).fill('agent-pass-456');
  await agent.getByLabel('Confirm new password').fill('agent-pass-456');
  await agent.getByRole('button', { name: 'Save password' }).click();
  await expect(inboxHeading(agent)).toBeVisible();
  return { agent, context };
}

test('admin: every place of the rail or the tabs opens its page', async ({ page }) => {
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  if (isDesktop(page)) {
    expect(await places(page)).toEqual([
      'nav-chats',
      'nav-reports',
      'nav-ask-ezy',
      'nav-members',
      'nav-settings',
    ]);
    await expect(page.getByTestId('app-tabs')).toBeHidden();
    await page.getByTestId('nav-reports').click();
    await expect(page).toHaveURL(/\/admin\/reports$/);
    await expect(page.getByTestId('nav-reports')).toHaveAttribute('aria-current', 'page');
    // Reports is a place of its own: no Settings side menu
    await expect(page.getByTestId('settings-nav')).toHaveCount(0);
    await page.getByTestId('nav-members').click();
    await expect(page).toHaveURL(/\/admin\/members$/);
    await page.getByTestId('nav-settings').click();
    // App settings, or the WhatsApp page while the number needs an admin
    await expect(page).toHaveURL(/\/admin\/(settings|whatsapp)/);
    await expect(page.getByTestId('settings-nav')).toBeVisible();
    await expect(page.getByTestId('nav-settings')).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('nav-chats').click();
    await expect(inboxHeading(page)).toBeVisible();
  } else {
    expect(await places(page)).toEqual(['tab-chats', 'tab-reports', 'tab-ask-ezy', 'tab-settings']);
    await expect(page.getByTestId('app-rail')).toBeHidden();
    for (const tab of await page.getByTestId('app-tabs').locator('a, button').all())
      expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('tab-reports').click();
    await expect(page).toHaveURL(/\/admin\/reports$/);
    await expect(page.getByTestId('phone-bar')).toContainText('Reports');
    await page.getByTestId('tab-settings').click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId('settings-home')).toBeVisible();
    await expectNoHorizontalScroll(page, 'Settings list');
    await page.getByTestId('tab-chats').click();
    await expect(inboxHeading(page)).toBeVisible();
  }
});

test('Ask Ezy opens from the rail or the tab and closes again', async ({ page }) => {
  await page.goto('/');
  const button = page.getByTestId(isDesktop(page) ? 'nav-ask-ezy' : 'tab-ask-ezy');
  await button.click();
  await expect(page.getByRole('dialog', { name: /Ask Ezy/ })).toBeVisible();
  if (isDesktop(page)) {
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.click();
  } else {
    // full screen on phones: the panel's own close button
    await page.getByRole('button', { name: 'Close Ask Ezy' }).click();
  }
  await expect(page.getByRole('dialog', { name: /Ask Ezy/ })).toBeHidden();
});

test('the Chats count follows the server and hides the tabs inside a chat', async ({
  page,
  baseURL,
}, info) => {
  const jid = customerJid(info, 41);
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  await fakeIncoming(page, { chatJid: jid, text: 'Hi, is the shop open today?' }, baseURL!);
  const chats = page.getByTestId(isDesktop(page) ? 'nav-chats' : 'tab-chats');
  // Other tests add chats in parallel: compare the badge with the server's count at the same moment.
  await expect(async () => {
    const count = await unreadOnServer(page);
    expect(count).toBeGreaterThan(0);
    await expect(chats.getByTestId('nav-unread-count')).toHaveText(
      count > 99 ? '99+' : String(count),
      { timeout: 1000 },
    );
  }).toPass({ timeout: 15_000 });
  await expect(chats).toContainText(/chats? with unread messages/);

  await chatItem(page, jid).click();
  await expect(page).toHaveURL(new RegExp(`${chatHref(jid).replace(/[.?+]/g, '\\$&')}$`));
  // the composer owns the bottom of a phone screen
  await expect(page.getByTestId('app-tabs')).toHaveCount(0);
  if (isDesktop(page)) await expect(page.getByTestId('app-rail')).toBeVisible();
  // reading the chat lowers the count everywhere
  await expect(async () => {
    const res = await page.request.get('/api/chats?status=open&assigned=any&limit=200');
    const row = (
      (await res.json()) as { chats: { jid: string; unreadCount: number }[] }
    ).chats.find((c) => c.jid === jid);
    expect(row?.unreadCount).toBe(0);
  }).toPass({ timeout: 15_000 });
});

test('team member: Chats, Ask Ezy and Account; no admin place', async ({
  browser,
  page,
  baseURL,
}, info) => {
  const { agent, context } = await signInAsAgent(browser, page, baseURL!, projectTag(info));
  try {
    if (isDesktop(agent)) {
      expect(await places(agent)).toEqual(['nav-chats', 'nav-ask-ezy']);
      await agent.getByRole('button', { name: 'Account menu' }).click();
      await expect(agent.getByRole('menuitem', { name: 'Admin settings' })).toHaveCount(0);
      await agent.keyboard.press('Escape');
    } else {
      expect(await places(agent)).toEqual(['tab-chats', 'tab-ask-ezy', 'tab-account']);
      await agent.getByTestId('tab-account').click();
      await expect(agent).toHaveURL(/\/account$/);
      await expect(agent.getByTestId('tab-account')).toHaveAttribute('aria-current', 'page');
      await expect(agent.getByTestId('account-sign-out')).toBeVisible();
      // the Account tab is their own place: no back arrow
      await expect(agent.getByTestId('phone-bar').getByRole('link')).toHaveCount(0);
      await expectNoHorizontalScroll(agent, 'Account page');
    }
    await expect(agent.getByTestId('nav-settings')).toHaveCount(0);
    await expect(agent.getByTestId('tab-settings')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
