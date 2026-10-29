import type { Page } from '@playwright/test';
import {
  chatHref,
  customerJid,
  expect,
  expectNoHorizontalScroll,
  fakeIncoming,
  test,
} from './helpers';

/**
 * The Zoho CRM connector against the fake Zoho (--fake-wa): sign-in in a new window in the chosen
 * Zoho site, per-agent settings (Add new leads), the gallery and agent-page rows, the customer
 * panel (a lead found by number, Add as a lead), an expired sign-in and Disconnect. The connector
 * is install-wide, so only the desktop project changes it; the phone projects check the screens.
 */

const DESKTOP = 'desktop-chromium';
/** The fake Zoho's seeded lead (Jason Lim, Lim Trading). */
const JASON = '60129001234@s.whatsapp.net';

async function ensureAgent(page: Page, project: string): Promise<number> {
  const list = async () =>
    ((await (await page.request.get('/api/ai/agents')).json()) as { agents: { id: number }[] })
      .agents;
  const existing = await list();
  if (existing.length) return existing[0]!.id;
  if (project !== DESKTOP) {
    await expect.poll(async () => (await list()).length, { timeout: 45_000 }).toBeGreaterThan(0);
    return (await list())[0]!.id;
  }
  await page.goto('/admin/members/ai/new');
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

const origin = (page: Page) => ({ origin: new URL(page.url()).origin });

test('Zoho CRM: sign in, Add new leads, customer panel, expired sign-in, disconnect', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(
    info.project.name !== DESKTOP,
    'the Zoho account is install-wide: one project drives it',
  );
  const agentId = await ensureAgent(page, info.project.name);

  await page.goto('/admin/connectors/zoho-crm');
  const account = page.getByTestId('zoho-crm-account');
  await expect(account.getByRole('button', { name: 'Connect Zoho CRM' })).toBeVisible();
  await account.getByTestId('zoho-region').click();
  await page.getByRole('option', { name: 'zoho.eu (Europe)' }).click();
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    account.getByRole('button', { name: 'Connect Zoho CRM' }).click(),
  ]);
  await expect(page.getByTestId('zoho-signing-in')).toBeVisible();
  await popup.waitForURL(/\/api\/dev\/fake-zoho\/consent/);
  await popup.locator('#accept').click();
  await expect(popup.locator('h1')).toHaveText('Zoho CRM connected');
  await popup.close();

  await expect(account.getByText('Demo Trading Sdn Bhd')).toBeVisible({ timeout: 15_000 });
  await expect(account.getByText('zoho.eu (Europe)')).toBeVisible();
  await expect(account.getByRole('link', { name: /Open Zoho CRM/ })).toHaveAttribute(
    'href',
    'https://crm.zoho.eu/crm/org700123456/',
  );
  await expectNoHorizontalScroll(page, 'zoho-crm');

  // Settings: Add new leads on, owner "Sales Rep", saved and still there after a reload.
  await page.getByRole('tab', { name: 'Settings' }).click();
  const settings = page.getByTestId('agent-zoho-crm');
  await settings.getByRole('switch', { name: 'Add new leads' }).click();
  await settings.getByTestId('zoho-owner').click();
  await page.getByRole('option', { name: 'Sales Rep' }).click();
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByTestId('agent-zoho-crm').getByRole('switch', { name: 'Add new leads' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('zoho-owner')).toContainText('Sales Rep');

  // The gallery puts it under "Your connectors"; the agent page has the summary row.
  await page.goto('/admin/connectors');
  await expect(
    page.getByTestId('connector-card-zoho-crm').getByTestId('connector-status-connected'),
  ).toBeVisible();
  await page.goto(`/admin/members/ai/${agentId}`);
  await expect(page.getByTestId('agent-connector-zoho-crm')).toContainText(
    'Finds customers and adds new leads',
  );

  // Customer panel: the seeded lead by number; a new number added as a lead by the team.
  await fakeIncoming(
    page,
    { chatJid: JASON, text: 'Hi, any promotion?', senderName: 'Jason' },
    baseURL!,
  );
  await page.goto(chatHref(JASON));
  await page.getByRole('button', { name: /Open customer details/ }).click();
  const card = page.getByTestId('customer-zoho-crm');
  await expect(card.getByText('Jason Lim')).toBeVisible();
  await expect(card.getByText('Lead status: Contacted')).toBeVisible();
  const fresh = customerJid(info, 41);
  await fakeIncoming(
    page,
    { chatJid: fresh, text: 'Quote for 50 pax?', senderName: 'Nora Aziz' },
    baseURL!,
  );
  await page.goto(chatHref(fresh));
  await page.getByRole('button', { name: /Open customer details/ }).click();
  const freshCard = page.getByTestId('customer-zoho-crm');
  await expect(freshCard.getByText('Not in Zoho CRM yet.')).toBeVisible();
  await freshCard.getByRole('button', { name: 'Add as a lead' }).click();
  await expect(freshCard.getByText('Nora Aziz')).toBeVisible();
  await expect(freshCard.getByText(/Added from/)).toBeVisible();

  // Activity names the teammate's lead.
  await page.goto('/admin/connectors/zoho-crm?tab=activity');
  await expect(page.getByTestId('zoho-activity')).toContainText('added Nora Aziz as a lead');

  // Zoho refuses the saved sign-in: the gallery needs attention, the page asks to sign in again.
  expect(
    (
      await page.request.post('/api/dev/fake-zoho', {
        data: { state: 'expired' },
        headers: origin(page),
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/admin/connectors');
  await expect(
    page.getByTestId('connector-card-zoho-crm').getByTestId('connector-status-attention'),
  ).toBeVisible();
  await page.goto('/admin/connectors/zoho-crm');
  await expect(page.getByText('Zoho sign-in expired')).toBeVisible();

  // Back to working, then Disconnect (confirmed).
  await page.request.post('/api/dev/fake-zoho', { data: { state: 'ok' }, headers: origin(page) });
  await page.goto('/admin/connectors/zoho-crm');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText('Zoho CRM disconnected')).toBeVisible();
  await expect(account.getByRole('button', { name: 'Connect Zoho CRM' })).toBeVisible();
});

test('Zoho CRM page fits a phone and lists both AI tools', async ({ page }) => {
  await page.goto('/admin/connectors/zoho-crm');
  await expect(page.getByTestId('connector-page-zoho-crm')).toBeVisible();
  await expect(page.getByText('Find the customer').first()).toBeVisible();
  await expect(page.getByText('Add a lead').first()).toBeVisible();
  await expect(page.getByTestId('zoho-crm-account')).toBeVisible();
  await expectNoHorizontalScroll(page, 'zoho-crm');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expectNoHorizontalScroll(page, 'zoho-crm settings');
});
