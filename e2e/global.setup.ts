import { mkdirSync } from 'node:fs';
import { ADMIN, QUICK_REPLY, expect, inboxHeading, test as setup } from './helpers';

const ADMIN_STATE = 'e2e/.auth/admin.json';

setup('first-run setup wizard creates the admin', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Welcome to EzyChat Lite' })).toBeVisible();

  await page.getByLabel('Business name').fill('E2E Shop');
  await page.getByLabel('Your name').fill(ADMIN.displayName);
  // Username is filled in from "Your name"; the specs sign in with a fixed one.
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Fake WhatsApp is already "open", so the link step shows linked and Continue is enabled.
  await expect(page.getByText('WhatsApp linked')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  // The AI assistant step is skippable; e2e never connects a real AI.
  await expect(page.getByRole('heading', { name: 'AI assistant', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByText('Your inbox is ready')).toBeVisible();
  await page.getByRole('button', { name: 'Go to inbox' }).click();
  await expect(inboxHeading(page)).toBeVisible();

  // Setup is closed now.
  const status = await page.request.get('/api/setup/status');
  expect(await status.json()).toMatchObject({ needsSetup: false });

  // Admin creates the shared `/hi` quick reply used by the inbox specs.
  await page.goto('/admin/quick-replies');
  await page.getByRole('button', { name: 'New quick reply' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Shortcut').fill(QUICK_REPLY.shortcut);
  await dialog.getByLabel('Reply text').fill(QUICK_REPLY.body);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`/${QUICK_REPLY.shortcut}`, { exact: true }).first()).toBeVisible();

  mkdirSync('e2e/.auth', { recursive: true });
  await page.context().storageState({ path: ADMIN_STATE });
});
