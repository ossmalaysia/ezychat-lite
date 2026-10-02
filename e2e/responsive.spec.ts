import {
  chatHref,
  customerJid,
  expect,
  test,
  expectNoHorizontalScroll,
  fakeIncoming,
  inboxHeading,
} from './helpers';

/** Every screen must fit a 360px-wide phone with no horizontal page scroll. */
test.describe('360px: no horizontal scroll', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('inbox, conversation and every admin page', async ({ page, baseURL }, info) => {
    const jid = customerJid(info, 3);
    await page.goto('/');
    await expect(inboxHeading(page)).toBeVisible();
    await fakeIncoming(
      page,
      {
        chatJid: jid,
        text: 'A fairly long first message to make sure long previews and bubbles wrap instead of overflowing: https://example.com/some/really/long/path/that/does/not/break/naturally/at/all',
        senderName: 'Customer With A Really Long Display Name For Truncation',
      },
      baseURL!,
    );
    await expect(page.locator(`a[href="${chatHref(jid)}"]`)).toBeVisible();
    await expectNoHorizontalScroll(page, 'inbox');

    await page.goto(chatHref(jid));
    await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('log', { name: 'Messages' }).getByText(/A fairly long first message/),
    ).toBeVisible();
    await expectNoHorizontalScroll(page, 'conversation');

    const adminPages: { path: string; heading: string }[] = [
      { path: 'members', heading: 'Members' },
      { path: 'quick-replies', heading: 'Quick replies' },
      { path: 'whatsapp', heading: 'WhatsApp' },
      { path: 'tunnel', heading: 'Tunnel' },
      { path: 'settings', heading: 'Settings' },
      { path: 'audit', heading: 'Audit' },
    ];
    for (const p of adminPages) {
      await page.goto(`/admin/${p.path}`);
      await expect(
        page.getByRole('heading', { name: new RegExp(`^${p.heading}`) }).first(),
      ).toBeVisible();
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await expectNoHorizontalScroll(page, `admin/${p.path}`);
    }
  });
});

test.describe('360px: no horizontal scroll (signed out)', () => {
  test.use({ viewport: { width: 360, height: 780 }, storageState: { cookies: [], origins: [] } });

  test('login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expectNoHorizontalScroll(page, 'login');
  });
});
