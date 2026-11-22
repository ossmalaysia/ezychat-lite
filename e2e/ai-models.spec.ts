import { expect, expectNoHorizontalScroll, test } from './helpers';

// AI models per task (docs/ai-models.md) against the real server with fake WhatsApp: no model is ever called,
// the card only reads and saves which model each job uses. It never changes the shared AI connection (other specs
// run in parallel on it), so it works on whichever connection is saved; the levels are covered by unit tests.
test('Settings → AI → AI models: change a row, keep it after a reload, return it to the default', async ({
  page,
}, info) => {
  test.skip(!['desktop-chromium', 'mobile'].includes(info.project.name));
  await page.goto('/admin/settings/ai');
  const card = page.getByTestId('ai-models-settings');
  await expect(card.getByText('AI models', { exact: true })).toBeVisible();
  const translate = card.getByTestId('ai-models-translate');
  await expect(translate.getByRole('combobox')).toContainText('Fast (recommended)');
  await expectNoHorizontalScroll(page, `settings/ai ai-models ${info.project.name}`);

  await translate.getByRole('combobox').click();
  await page.getByRole('option', { name: /^Main model/ }).click();
  await card.getByTestId('ai-models-save').click();
  await expect(translate.getByTestId('ai-models-translate-default')).toBeVisible();

  await page.reload();
  const again = page.getByTestId('ai-models-settings').getByTestId('ai-models-translate');
  await expect(again.getByRole('combobox')).toContainText('Main model');

  await again.getByTestId('ai-models-translate-default').click();
  await page.getByTestId('ai-models-save').click();
  await expect(again.getByTestId('ai-models-translate-default')).toBeHidden();
  await expect(again.getByRole('combobox')).toContainText('Fast (recommended)');
});
