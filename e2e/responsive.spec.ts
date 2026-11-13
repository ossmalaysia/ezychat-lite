import {
  chatHref,
  customerJid,
  expect,
  test,
  expectNoHorizontalScroll,
  fakeIncoming,
  inboxHeading,
  projectTag,
} from './helpers';

test('phones and short phones reach every admin page from the Settings tab', async ({ page }) => {
  for (const size of [
    { width: 360, height: 780 },
    { width: 740, height: 360 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/');
    const tab = page.getByTestId('tab-settings');
    await expect(tab).toBeInViewport();
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await tab.click();
    const home = page.getByTestId('settings-home');
    await home.getByRole('link', { name: 'Quick replies', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/quick-replies$/);
    await expect(
      page.getByRole('heading', { name: 'Quick replies', exact: true }).last(),
    ).toBeVisible();
    // the phone app bar goes back to the Settings list
    const back = page.getByRole('link', { name: 'Back to Settings', exact: true });
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await back.click();
    await expect(home).toBeVisible();
    await expectNoHorizontalScroll(page, `${size.width}px Settings list`);
  }
});

test('the Settings side menu footer stays readable and reachable on short screens', async ({
  page,
}, info) => {
  for (const size of [
    { width: 1280, height: 800 },
    { width: 1280, height: 360 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/admin/settings');
    const footer = page
      .getByLabel('Admin tools and support', { exact: true })
      .filter({ visible: true });
    await expect(footer).toBeVisible();
    // Support links are folded into one "Help & feedback" item.
    const help = footer.getByRole('button', { name: 'Help & feedback', exact: true });
    await help.scrollIntoViewIfNeeded();
    await help.click();
    for (const item of [
      footer.getByRole('button', { name: 'Send feedback', exact: true }),
      footer.getByRole('link', { name: 'Custom features', exact: true }),
    ]) {
      await item.scrollIntoViewIfNeeded();
      await expect(item).toBeInViewport();
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const footerSize = await footer.evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(footerSize.scroll).toBeLessThanOrEqual(footerSize.width + 1);
    await expectNoHorizontalScroll(page, `${size.width}px admin footer`);
    await page.screenshot({ path: info.outputPath(`admin-footer-${size.width}.png`) });
    const sections = page.getByRole('navigation', { name: 'Admin sections' });
    await sections.getByRole('link', { name: 'Quick replies', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/quick-replies$/);
    await expect(page.getByRole('heading', { name: 'Quick replies', exact: true })).toBeVisible();
  }
});

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
      { path: 'tunnel', heading: 'Phone access' },
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

    await page.goto('/change-password');
    await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
    await expectNoHorizontalScroll(page, 'change-password');
    for (const size of [
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ]) {
      await page.setViewportSize(size);
      for (const path of [
        '/',
        chatHref(jid),
        ...adminPages.map((p) => `/admin/${p.path}`),
        '/change-password',
      ]) {
        await page.goto(path);
        if (path === '/') await expect(inboxHeading(page)).toBeVisible();
        else if (path === chatHref(jid))
          await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
        else await expect(page.locator('main').first()).toBeVisible();
        await expectNoHorizontalScroll(page, `${size.width}px ${path}`);
      }
    }
  });

  test('every row of the phone Settings list navigates and comes back', async ({ page }) => {
    for (const [label, path] of [
      ['Members', 'members'],
      ['Quick replies', 'quick-replies'],
      ['WhatsApp', 'whatsapp'],
      ['Safety', 'safety'],
      ['Connectors', 'connectors'],
      ['Phone access', 'tunnel'],
      ['App settings', 'settings/general'],
      ['Audit', 'audit'],
    ]) {
      await page.goto('/admin');
      const home = page.getByTestId('settings-home');
      await home.getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/${path}$`));
      await expect(page.getByTestId('tab-settings')).toHaveAttribute('aria-current', 'page');
      await page.getByRole('link', { name: 'Back to Settings', exact: true }).click();
      await expect(home).toBeVisible();
    }
  });

  test('long member names wrap inside phone dialogs', async ({ page, baseURL }, info) => {
    const displayName = 'LongUnbrokenName'.repeat(4);
    const username = `wrap-${projectTag(info)}-${Date.now()}`;
    const created = await page.request.post('/api/users', {
      headers: { Origin: baseURL! },
      data: {
        username,
        displayName,
        role: 'agent',
        password: 'test-only-pass-123',
      },
    });
    expect(created.ok()).toBeTruthy();
    await page.goto('/admin/members');
    const member = page.locator('li').filter({ hasText: username });
    await member.getByRole('button', { name: `Edit ${displayName}`, exact: true }).click();
    const title = page.getByRole('heading', { name: `Edit ${displayName}`, exact: true });
    await expect(title).toBeVisible();
    const m = await title.evaluate((e) => ({ width: e.clientWidth, scroll: e.scrollWidth }));
    expect(m.scroll).toBeLessThanOrEqual(m.width + 1);
    await expectNoHorizontalScroll(page, 'long-name dialog');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
});

test.describe('short landscape: dialogs remain reachable', () => {
  test.use({ viewport: { width: 740, height: 360 } });
  test('member and quick reply forms fit and scroll to their actions', async ({ page }) => {
    for (const [path, action, title, submit] of [
      ['members', 'Add member', 'Add member', 'Create member'],
      ['quick-replies', 'New quick reply', 'New quick reply', 'Save'],
    ]) {
      await page.goto(`/admin/${path}`);
      await page.getByRole('button', { name: action, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await expect(dialog).toBeVisible();
      const bounds = await dialog.evaluate((e) => ({
        top: e.getBoundingClientRect().top,
        bottom: e.getBoundingClientRect().bottom,
        viewport: window.innerHeight,
      }));
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport);
      await dialog.getByRole('button', { name: submit, exact: true }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole('button', { name: submit, exact: true })).toBeInViewport();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
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
