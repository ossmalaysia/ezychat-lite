import { ADMIN, expect, inboxHeading, test, projectTag, signIn, signOutFromInbox } from './helpers';

test.describe('admin: members', () => {
  // Fresh session: this flow signs out, which must not revoke the shared admin storage state.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('admin logs out from desktop and phone menus without disconnecting WhatsApp', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 360, height: 780 },
    ]) {
      await page.setViewportSize(viewport);
      await signIn(page, ADMIN.username, ADMIN.password);
      await expect(inboxHeading(page)).toBeVisible();
      const before = await (await page.request.get('/api/wa/status')).json();
      await page.goto('/admin/settings');
      if (viewport.width < 768)
        await page.getByRole('button', { name: 'Admin menu', exact: true }).click();
      const footer = page
        .getByLabel('Admin tools and support', { exact: true })
        .filter({ visible: true });
      await footer.getByRole('button', { name: 'Log out', exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      expect((await page.request.get('/api/users')).status()).toBe(401);
      await signIn(page, ADMIN.username, ADMIN.password);
      await expect(page).not.toHaveURL(/\/login$/);
      await page.goto('/');
      await expect(inboxHeading(page)).toBeVisible();
      const after = await (await page.request.get('/api/wa/status')).json();
      expect(after.state).toBe(before.state);
      expect(after.me).toEqual(before.me);
      await signOutFromInbox(page);
    }
  });

  test('admin creates an agent; agent must change password and cannot open admin', async ({
    page,
  }, info) => {
    const agent = {
      username: `agent${projectTag(info)}${String(Date.now()).slice(-5)}`,
      displayName: `Agent ${projectTag(info)}`,
      temp: 'temp-pass-123',
      next: 'agent-pass-456',
    };

    await signIn(page, ADMIN.username, ADMIN.password);
    await expect(inboxHeading(page)).toBeVisible();

    await page.goto('/admin/members');
    await page.getByRole('button', { name: 'Add member' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Username').fill(agent.username);
    await dialog.getByLabel('Display name').fill(agent.displayName);
    await dialog.getByRole('combobox', { name: 'Role' }).click();
    await page.getByRole('option', { name: 'Agent' }).click();
    await dialog.getByLabel('Temporary password').fill(agent.temp);
    await dialog.getByRole('button', { name: 'Create member' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText(agent.displayName, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();

    // Sign out (from the inbox account menu) and sign in as the new agent.
    await page.goto('/');
    await expect(inboxHeading(page)).toBeVisible();
    await signOutFromInbox(page);

    await signIn(page, agent.username, agent.temp);
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

    // Forced password change cannot be bypassed by navigating away.
    await page.goto('/');
    await expect(page).toHaveURL(/\/change-password$/);

    await page.getByLabel('Current password').fill(agent.temp);
    await page.getByLabel('New password', { exact: true }).fill(agent.next);
    await page.getByLabel('Confirm new password').fill(agent.next);
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(inboxHeading(page)).toBeVisible();

    // Agents have no admin entry and are bounced from /admin.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Admin settings' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.goto('/admin/members');
    await expect(page).not.toHaveURL(/\/admin/);
    await expect(inboxHeading(page)).toBeVisible();
    const res = await page.request.get('/api/users');
    expect(res.status()).toBe(403);

    // The new password works for a fresh sign-in.
    await signOutFromInbox(page);
    await signIn(page, agent.username, agent.next);
    await expect(inboxHeading(page)).toBeVisible();
  });
});
