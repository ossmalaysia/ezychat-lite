import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

/**
 * `test` with an auto fixture that fails the test on uncaught page errors and on CSP
 * violations (e.g. the strict CSP blocking a built asset or an inline script).
 */
export const test = base.extend<{ pageHealth: void }>({
  pageHealth: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error' && /Content Security Policy|Refused to/i.test(text)) {
          problems.push(`console: ${text}`);
        }
      });
      await use();
      expect(problems, problems.join('\n')).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export const ADMIN = { username: 'admin', displayName: 'Admin', password: 'admin-pass-123' };
export const QUICK_REPLY = {
  shortcut: 'hi',
  body: 'Hi! Thanks for contacting us. How can we help?',
};

const PROJECT_CODES: Record<string, string> = {
  setup: '0',
  'desktop-chromium': '1',
  mobile: '2',
  iphone: '3',
};

/** Short per-project tag so parallel projects never touch the same chats/users. */
export function projectTag(info: TestInfo): string {
  return PROJECT_CODES[info.project.name] ?? '9';
}

/** A customer JID unique to this project + `slot`. */
export function customerJid(info: TestInfo, slot: number): string {
  return `60${projectTag(info)}${String(slot).padStart(2, '0')}${String(Date.now()).slice(-6)}@s.whatsapp.net`;
}

export function chatHref(jid: string): string {
  return `/chats/${encodeURIComponent(jid)}`;
}

/** The chat list row for `jid`. */
export function chatItem(page: Page, jid: string) {
  return page.locator(`a[href="${chatHref(jid)}"]`);
}

/**
 * Simulate an inbound WhatsApp message through the fake adapter. Uses the page's cookies
 * (`page.request` shares the browser context's cookie jar) and sends a matching Origin header,
 * like the browser would for a mutating request.
 */
export async function fakeIncoming(
  pageOrRequest: Page | APIRequestContext,
  body: { chatJid: string; text: string; senderName?: string },
  baseURL: string,
): Promise<void> {
  const request = 'request' in pageOrRequest ? pageOrRequest.request : pageOrRequest;
  const res = await request.post('/api/dev/fake-incoming', {
    data: body,
    headers: { Origin: new URL(baseURL).origin },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Asserts the page has no horizontal page scroll. */
export async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    m.scrollWidth,
    `${label}: scrollWidth ${m.scrollWidth} > innerWidth ${m.innerWidth}`,
  ).toBeLessThanOrEqual(m.innerWidth);
}

/** Opens the account menu in the inbox header and signs out. */
export async function signOutFromInbox(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

export async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const submit = async () => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ]);
    return response;
  };
  const response = await submit();
  if (response.status() !== 429) return;
  // Browser projects share loopback's login quota. Honor the server's actual cooldown.
  const seconds = Number(response.headers()['retry-after']);
  expect(Number.isInteger(seconds) && seconds > 0 && seconds <= 60).toBe(true);
  test.setTimeout(test.info().timeout + seconds * 1000);
  await page.waitForTimeout(seconds * 1000);
  expect((await submit()).status()).toBe(200);
}

export function inboxHeading(page: Page) {
  return page.getByRole('heading', { name: 'Inbox', exact: true });
}
