import { test, expect } from './helpers';
import type { DesktopUpdateState } from '@wa-team-inbox/shared';

test('phones and browsers have no host update workflow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'About EzyChat Lite', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'About EzyChat Lite' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review update', exact: true })).toHaveCount(0);
});

test('a verified host download prompts for restart without installing automatically', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => {
    let state: DesktopUpdateState = {
      isHost: true,
      canInstall: true,
      status: 'available',
      currentVersion: '0.1.14',
      checkedAt: null,
      error: null,
      release: {
        version: '0.1.15',
        name: 'EzyChat Lite 0.1.15',
        notes: 'Simpler app and service updates.',
        publishedAt: '2026-10-04T00:00:00Z',
        prerelease: false,
        releaseUrl: 'https://github.com/ossmalaysia/ezychat-lite/releases/tag/v0.1.15',
        downloadUrl:
          'https://github.com/ossmalaysia/ezychat-lite/releases/download/v0.1.15/EzyChat-Lite-0.1.15-win-x64.exe',
        assetName: 'EzyChat-Lite-0.1.15-win-x64.exe',
        assetSize: 100,
        assetSha256: 'a'.repeat(64),
      },
    };
    const listeners = new Set<(value: DesktopUpdateState) => void>();
    const actions = { installs: 0 };
    Object.defineProperty(window, 'testUpdateActions', { value: actions });
    const publish = (status: 'downloading' | 'ready' | 'installing') => {
      state = {
        ...state,
        transfer: { status, version: '0.1.15', downloadedBytes: 100, totalBytes: 100, error: null },
      };
      listeners.forEach((listener) => listener(state));
    };
    Object.defineProperty(window, 'watiUpdates', {
      value: {
        getState: async () => state,
        check: async () => state,
        openDownload: async () => {
          publish('downloading');
          setTimeout(() => publish('ready'), 100);
        },
        openRelease: async () => {},
        installUpdate: async () => {
          actions.installs++;
          publish('installing');
        },
        cancelDownload: async () => {},
        onChanged: (listener: (value: DesktopUpdateState) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    });
  });
  await page.goto('/');
  const suggestion = page.getByRole('complementary', { name: 'App update available' });
  await expect(suggestion).toBeVisible();
  const bounds = await suggestion.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(740);
  await page.getByRole('button', { name: 'Review update', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Update EzyChat Lite' })
    .getByRole('button', { name: 'Download 0.1.15', exact: true })
    .click();
  const prompt = page.getByRole('dialog', { name: 'Update EzyChat Lite' });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByText('Version 0.1.15 is downloaded and verified.')).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'testUpdateActions').installs)).toBe(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await prompt.getByRole('button', { name: 'Restart and update', exact: true }).click();
  await expect(prompt.getByText('Preparing to restart and update…')).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'testUpdateActions').installs)).toBe(1);
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
        name: 'EzyChat Lite 0.1.13',
        notes: 'A new preview with improvements.\n' + 'LongReleaseNote'.repeat(40),
        publishedAt: '2026-10-03T11:00:00Z',
        prerelease: true,
        releaseUrl: 'https://github.com/ossmalaysia/ezychat-lite/releases/tag/v0.1.13',
        downloadUrl:
          'https://github.com/ossmalaysia/ezychat-lite/releases/download/v0.1.13/EzyChat-Lite-0.1.13-win-x64.exe',
        assetName: 'EzyChat-Lite-0.1.13-win-x64.exe',
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
  const dialog = page.getByRole('dialog', { name: 'Update EzyChat Lite' });
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
