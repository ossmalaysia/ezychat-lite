import { test, expect, expectNoHorizontalScroll } from './helpers';

test('customer enrichment draft, save and Audit Details score', async ({ page }) => {
  // Browser fixtures never enable model calls in the shared e2e server.
  let enabled = false;
  await page.route('**/api/ai/enrichment', async (route) => {
    if (route.request().method() === 'PUT') enabled = route.request().postDataJSON().enabled;
    await route.fulfill({ json: { enabled, connected: false } });
  });
  await page.route('**/api/audit?*', async (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            id: 999,
            at: Date.now(),
            userId: null,
            action: 'customer.enrichment_update',
            ip: null,
            meta: {
              chatJid: '60129900001@s.whatsapp.net',
              changed: ['name', 'email'],
              enrichment: {
                average: 100,
                messageId: 'demo-source',
                policy: 'evidence-v1',
                fields: ['name', 'email'].map((field) => ({
                  field,
                  score: 100,
                  points: {
                    ownership: 30,
                    clarity: 25,
                    context: 20,
                    validation: 15,
                    freshness: 10,
                  },
                  operation: 'added',
                  threshold: 90,
                  reason: 'self_reported',
                })),
              },
            },
          },
        ],
      },
    }),
  );
  await page.goto('/admin/settings/ai');
  // Voice messages and Customer enrichment are folded under "More AI features".
  await page.getByText('More AI features', { exact: true }).click();
  const card = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText('Customer enrichment', { exact: true }) });
  const toggle = card.getByRole('switch', { name: 'Automatically update customer details' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  expect(enabled).toBe(false);
  await expect(
    card.getByText('Enrichment is paused until the AI connection is restored.'),
  ).toBeVisible();
  await card.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect.poll(() => enabled).toBe(true);
  await expectNoHorizontalScroll(page, 'customer enrichment settings');
  await card.getByRole('link', { name: 'View audit', exact: true }).click();
  const score = page.getByRole('button', { name: 'Enrichment details: Avg 100/100', exact: true });
  await expect(score).toBeVisible();
  const table = page.getByRole('table');
  if (await table.isVisible()) {
    const row = table.getByRole('row').filter({ has: score });
    await expect(row.getByRole('cell').nth(2)).toHaveText('Customer enriched');
    await expect(row.getByRole('cell').nth(3)).toContainText('Avg 100/100');
  }
  await score.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Enrichment details', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Threshold 90', { exact: true })).toHaveCount(2);
  await expect(dialog.getByRole('link', { name: 'View source conversation' })).toHaveAttribute(
    'href',
    '/chats/60129900001%40s.whatsapp.net?customer=1',
  );
  await expectNoHorizontalScroll(page, 'customer enrichment score');
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
});
