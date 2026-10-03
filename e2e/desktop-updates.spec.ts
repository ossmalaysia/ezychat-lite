import { test, expect } from './helpers';

test('phones and browsers have no host update workflow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'About WA Team Inbox', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'About WA Team Inbox' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review update', exact: true })).toHaveCount(0);
});

test('host update suggestion is readable, reviewed first and downloaded on request', async ({
  page,
}) => {
  // Exercise the web surface with an isolated Electron-bridge fixture. Native trust is tested separately.
  await page.addInitScript(() => {
    const state = {
      isHost: true,
      status: 'available',
      currentVersion: '0.1.12',
      checkedAt: '2026-10-03T12:00:00Z',
      error: null,
      release: {
        version: '0.1.13',
        name: 'WA Team Inbox 0.1.13',
        notes: 'A new preview with improvements.\n' + 'LongReleaseNote'.repeat(40),
        publishedAt: '2026-10-03T11:00:00Z',
        prerelease: true,
        releaseUrl: 'https://github.com/ossmalaysia/wa-team-inbox/releases/tag/v0.1.13',
        downloadUrl:
          'https://github.com/ossmalaysia/wa-team-inbox/releases/download/v0.1.13/WA-Team-Inbox-0.1.13-win-x64.exe',
        assetName: 'WA-Team-Inbox-0.1.13-win-x64.exe',
      },
    };
    const actions = { checks: 0, downloads: 0 };
    Object.defineProperty(window, 'testUpdateActions', { value: actions });
    Object.defineProperty(window, 'watiUpdates', {
      value: {
        getState: async () => state,
        check: async () => {
          actions.checks++;
          return state;
        },
        openDownload: async () => {
          actions.downloads++;
        },
        openRelease: async () => {},
        onChanged: () => () => {},
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Review update', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Update WA Team Inbox' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Preview release', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'testUpdateActions').downloads)).toBe(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await dialog.getByRole('button', { name: 'Download 0.1.13', exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, 'testUpdateActions').downloads)).toBe(1);
  await dialog.getByRole('button', { name: 'Check for updates', exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, 'testUpdateActions').checks)).toBe(1);
});
