import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalScroll, test } from './helpers';

/**
 * Admin → Connectors and the Google Calendar connector against the fake Google (--fake-wa): the
 * gallery, Vote links, sign-in through a new window (fake consent page → our loopback callback),
 * per-agent booking settings, a Google sign-in that expired, and Disconnect. The connector is
 * install-wide, so only the desktop project changes it; the phone projects check the screens.
 */

const DESKTOP = 'desktop-chromium';
const VOTE = /^https:\/\/wa\.me\/601159246128\?text=/;

/**
 * Lite has one AI agent and a fresh e2e install none. Create it the way ai-member.spec does (FAQ,
 * "Help desk") so the two specs leave the same agent whichever runs first; returns its id.
 */
async function ensureAgent(page: Page, project: string): Promise<number> {
  const list = async () =>
    ((await (await page.request.get('/api/ai/agents')).json()) as { agents: { id: number }[] })
      .agents;
  const existing = await list();
  if (existing.length) return existing[0]!.id;
  // One project creates it (two at once would race for Lite's single agent); the others wait.
  if (project !== DESKTOP) {
    await expect.poll(async () => (await list()).length, { timeout: 45_000 }).toBeGreaterThan(0);
    return (await list())[0]!.id;
  }
  await page.goto('/admin/members/ai/new');
  // ai-member.spec may create it at the same moment: then this page has no form to fill.
  const faq = page.getByRole('radio', { name: /FAQ/ });
  if (
    await faq.waitFor({ timeout: 10_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await faq.check();
    await page.getByLabel('Agent name', { exact: true }).fill('Help desk');
    await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  }
  await expect
    .poll(async () => (await list()).length, { message: 'the AI agent exists', timeout: 30_000 })
    .toBeGreaterThan(0);
  return (await list())[0]!.id;
}

test('the gallery lists ready, coming-soon and Enterprise-only connectors', async ({ page }) => {
  await page.goto('/admin/connectors');
  const gallery = page.getByTestId('connectors-gallery');
  await expect(gallery.getByRole('heading', { name: 'Connectors', exact: true })).toBeVisible();
  await expect(page.getByTestId('connector-card-google-calendar')).toBeVisible();

  // Coming soon: a Vote button that opens WhatsApp with a message naming the connector.
  const autocount = page.getByTestId('connector-card-autocount');
  await expect(autocount.getByTestId('connector-status-comingSoon')).toBeVisible();
  const vote = await autocount.getByTestId('vote-connector').getAttribute('href');
  expect(vote).toMatch(VOTE);
  expect(decodeURIComponent(vote!.split('text=')[1]!)).toContain('AutoCount');
  await expect(page.getByTestId('request-connector')).toHaveAttribute('href', VOTE);

  // Lite: the custom MCP connector is listed, greyed out, Enterprise only.
  await expect(
    page.getByTestId('connector-card-custom-mcp').getByTestId('connector-status-enterprise'),
  ).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search connectors' }).fill('zzz-nothing');
  await expect(page.getByText('No connector matches')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search connectors' }).fill('');
  await page.getByRole('button', { name: 'Accounting' }).click();
  await expect(page.getByTestId('connector-card-autocount')).toBeVisible();
  await expect(page.getByTestId('connector-card-google-calendar')).toHaveCount(0);
  await expectNoHorizontalScroll(page, 'connectors');

  await page.getByTestId('connector-card-autocount').getByRole('link').first().click();
  await expect(page.getByTestId('connector-page-autocount')).toBeVisible();
  await expect(page.getByTestId('vote-connector')).toHaveAttribute('href', VOTE);
  await expectNoHorizontalScroll(page, 'connectors');

  await page.goto('/admin/connectors/custom-mcp');
  await expect(page.getByText('This connector is part of EzyChat Enterprise.')).toBeVisible();
  await page.goto('/admin/connectors/no-such-thing');
  await expect(page.getByText('This connector does not exist.')).toBeVisible();
  await page.getByRole('link', { name: 'All connectors' }).click();
  await expect(page).toHaveURL(/\/admin\/connectors$/);
});

test('Google Calendar: sign in, booking settings, expired sign-in, disconnect', async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== DESKTOP,
    'the Google account is install-wide: one project drives it',
  );

  await ensureAgent(page, info.project.name);
  await page.goto('/admin/connectors/google-calendar');
  const account = page.getByTestId('google-calendar-account');
  await expect(account.getByRole('button', { name: 'Connect Google Calendar' })).toBeVisible();

  // Sign in: a new window opens the (fake) Google consent page; Allow returns to our callback.
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    account.getByRole('button', { name: 'Connect Google Calendar' }).click(),
  ]);
  await expect(page.getByTestId('google-signing-in')).toBeVisible();
  await popup.waitForURL(/\/api\/dev\/fake-google\/consent/);
  await popup.locator('#allow').click();
  await expect(popup.locator('h1')).toBeVisible();
  await popup.close();

  await expect(account.getByText('Working')).toBeVisible({ timeout: 15_000 });
  await expect(account.getByText('Bookings', { exact: true })).toBeVisible();
  await expect(account.getByText('Read only')).toBeVisible();

  // Settings tab: the default agent, the Bookings calendar (read-only calendars are not offered),
  // booking on, saved and still there after a reload.
  await page.getByRole('tab', { name: 'Settings' }).click();
  const booking = page.getByTestId('agent-bookings');
  await expect(booking).toBeVisible();
  await booking.getByTestId('booking-calendar').click();
  await expect(page.getByRole('option', { name: 'Holidays in Malaysia' })).toHaveCount(0);
  await page.getByRole('option', { name: 'Bookings', exact: true }).click();
  await booking.getByRole('switch', { name: 'Book appointments' }).click();
  await page.getByRole('button', { name: 'Save bookings' }).click();
  await expect(page.getByText('Booking settings saved')).toBeVisible();
  await page.reload();
  await expect(
    page.getByTestId('agent-bookings').getByRole('switch', { name: 'Book appointments' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('booking-calendar')).toContainText('Bookings');

  // The gallery puts it under "Your connectors"; the agent page shows the summary row.
  await page.goto('/admin/connectors');
  await expect(
    page.getByTestId('connector-card-google-calendar').getByTestId('connector-status-connected'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your connectors' })).toBeVisible();

  // Google refuses the saved sign-in: the page asks to sign in again, the gallery needs attention.
  const expire = await page.request.post('/api/dev/fake-google-calendar', {
    data: { state: 'expired' },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(expire.ok()).toBe(true);
  await page.reload();
  await expect(
    page.getByTestId('connector-card-google-calendar').getByTestId('connector-status-attention'),
  ).toBeVisible();
  await page.goto('/admin/connectors/google-calendar');
  await expect(page.getByText('Google sign-in expired')).toBeVisible();
  await expectNoHorizontalScroll(page, 'connectors');

  // Back to working, then Disconnect (confirmed); the booking settings stay for next time.
  await page.request.post('/api/dev/fake-google-calendar', {
    data: { state: 'ok' },
    headers: { origin: new URL(page.url()).origin },
  });
  await page.goto('/admin/connectors/google-calendar');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText('Google Calendar disconnected')).toBeVisible();
  await expect(
    page.getByTestId('google-calendar-account').getByRole('button', {
      name: 'Connect Google Calendar',
    }),
  ).toBeVisible();
});

test('the agent page links to its connectors', async ({ page }, info) => {
  await page.goto(`/admin/members/ai/${await ensureAgent(page, info.project.name)}`);
  const card = page.getByTestId('agent-connectors');
  await expect(card).toBeVisible();
  await card.getByRole('link', { name: 'Browse connectors' }).click();
  await expect(page).toHaveURL(/\/admin\/connectors$/);
  await expectNoHorizontalScroll(page, 'connectors');
});
