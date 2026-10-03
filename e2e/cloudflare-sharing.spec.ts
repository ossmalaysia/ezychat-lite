import { readFile } from 'node:fs/promises';
import { expect, expectNoHorizontalScroll, test } from './helpers';

test.describe('guided setup and app sharing at phone width', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('chooses a Cloudflare domain and publishes only after explicit submission', async ({
    page,
  }) => {
    let createBody: unknown = null;
    await page.route('**/api/tunnel/cloudflare', (route) =>
      route.fulfill({
        json: {
          state: 'connected',
          loginUrl: null,
          error: null,
          busy: false,
          managed: null,
          domains: [
            { id: 'a'.repeat(32), name: 'example.com', accountName: 'Demo account' },
            { id: 'b'.repeat(32), name: 'example.org', accountName: 'Demo account' },
          ],
        },
      }),
    );
    await page.route('**/api/tunnel/cloudflare/create', async (route) => {
      createBody = route.request().postDataJSON();
      await route.fulfill({
        json: {
          mode: 'named',
          state: 'starting',
          hostname: 'support.example.org',
          url: 'https://support.example.org',
          lastError: null,
          logTail: [],
        },
      });
    });
    await page.goto('/admin/tunnel');
    await page.getByRole('radio', { name: /^Your domain/ }).click();
    await expect(page.getByText('Cloudflare account connected.', { exact: true })).toBeVisible();
    expect(createBody).toBeNull();
    await page.getByRole('combobox', { name: 'Domain', exact: true }).click();
    await page.getByRole('option', { name: 'example.org', exact: true }).click();
    await page.getByRole('textbox', { name: 'Address prefix', exact: true }).fill('support');
    await page.getByRole('textbox', { name: 'Tunnel name', exact: true }).fill('My team inbox');
    await expect(page.getByLabel('Inbox address preview')).toHaveText(
      'https://support.example.org',
    );
    await expectNoHorizontalScroll(page, 'Cloudflare guided setup');
    await page.getByRole('button', { name: 'Create and connect inbox', exact: true }).click();
    await expect
      .poll(() => createBody)
      .toEqual({ domainId: 'b'.repeat(32), subdomain: 'support', tunnelName: 'My team inbox' });
    await expect(page.getByText('Cloudflare connection saved', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create and connect inbox', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change address', exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, 'Saved Cloudflare address');
  });

  test('shares the public project and downloads a real Instagram PNG', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Share this app', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share this app', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Public app link', { exact: true })).toHaveValue(
      'https://github.com/ossmalaysia/ezychat-lite',
    );
    await expect(dialog.getByLabel('Your message', { exact: true })).toHaveValue(/I own my data/);
    for (const [platform, param] of [
      ['LinkedIn', 'url'],
      ['Facebook', 'u'],
    ] as const) {
      const link = await dialog
        .getByRole('link', { name: new RegExp(`^${platform}`) })
        .getAttribute('href');
      expect(new URL(link!).searchParams.get(param)).toBe(
        'https://github.com/ossmalaysia/ezychat-lite',
      );
    }
    await expectNoHorizontalScroll(page, 'Share this app');
    const downloading = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download Instagram image', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('ezychat-lite.png');
    const bytes = await readFile((await download.path())!);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(1080);
    expect(bytes.readUInt32BE(20)).toBe(1080);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toBeHidden();
  });
});
