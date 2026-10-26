import { customerJid, expect, expectNoHorizontalScroll, fakeIncoming, test } from './helpers';

test('Admin → Reports counts a new customer and shows busy days, busy times and the tables', async ({
  page,
  baseURL,
}, info) => {
  const jid = customerJid(info, 61);
  await fakeIncoming(
    page,
    { chatJid: jid, senderName: 'Report Lead', text: 'Hi, price?' },
    baseURL!,
  );

  const answer = page.waitForResponse((r) => r.url().includes('/api/reports?days=30'));
  await page.goto('/admin/reports');
  const report = (await (await answer).json()) as { totals: { newCustomers: number } };
  expect(report.totals.newCustomers).toBeGreaterThanOrEqual(1);

  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  const totals = page.getByTestId('report-totals');
  await expect(totals.getByText('New customers')).toBeVisible();
  await expect(
    totals.getByText(String(report.totals.newCustomers), { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByTestId('weekday-chart')).toBeVisible();
  await expect(page.getByTestId('hours-heatmap')).toBeVisible();
  await expect(page.getByTestId('daily-readout')).toContainText('from customers');
  await expectNoHorizontalScroll(page, 'reports');

  const busyDays = page.getByTestId('card-weekdays');
  await busyDays.getByRole('button', { name: 'Show as table' }).click();
  await expect(busyDays.getByRole('columnheader', { name: 'Messages (avg)' })).toBeVisible();

  const seven = page.waitForResponse((r) => r.url().includes('/api/reports?days=7'));
  await page.getByText('7 days', { exact: true }).click();
  expect((await seven).status()).toBe(200);
  await expect(page.getByTestId('report-totals')).toBeVisible();
});
