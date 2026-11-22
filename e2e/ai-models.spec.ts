import { expect, expectNoHorizontalScroll, test } from './helpers';

// AI models per task (docs/ai-models.md) against the real server with fake WhatsApp: no model is ever called,
// the card only reads and saves which model each job uses.
test('Settings → AI → AI models: change a row, keep it after a reload, return it to the default', async ({
  page,
}, info) => {
  test.skip(!['desktop-chromium', 'mobile'].includes(info.project.name));
  // Other specs share this server: run on ChatGPT sign-in (every model has a level), then restore their connection.
  await page.goto('/admin/settings/ai');
  const origin = new URL(page.url()).origin;
  const before = (await (await page.request.get('/api/ai')).json()) as {
    settings: { mode: string; model: string };
  };
  const connect = (mode: string, model: string) =>
    page.request.patch('/api/ai/connection', { data: { mode, model }, headers: { origin } });
  expect((await connect('chatgpt', '')).ok()).toBe(true);
  await page.reload();
  const card = page.getByTestId('ai-models-settings');
  await expect(card.getByText('AI models', { exact: true })).toBeVisible();
  const translate = card.getByTestId('ai-models-translate');
  await expect(translate.getByRole('combobox')).toContainText('Fast (recommended)');
  await expectNoHorizontalScroll(page, `settings/ai ai-models ${info.project.name}`);

  await translate.getByRole('combobox').click();
  await page.getByRole('option', { name: /^Main model/ }).click();
  await translate.getByText('Smarter', { exact: true }).click();
  await card.getByTestId('ai-models-save').click();
  await expect(translate.getByTestId('ai-models-translate-default')).toBeVisible();

  await page.reload();
  const again = page.getByTestId('ai-models-settings').getByTestId('ai-models-translate');
  await expect(again.getByRole('combobox')).toContainText('Main model');
  await expect(again.getByRole('radio', { name: 'Smarter' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await again.getByTestId('ai-models-translate-default').click();
  await page.getByTestId('ai-models-save').click();
  await expect(again.getByTestId('ai-models-translate-default')).toBeHidden();
  await expect(again.getByRole('combobox')).toContainText('Fast (recommended)');
  expect((await connect(before.settings.mode, before.settings.model)).ok()).toBe(true);
});
