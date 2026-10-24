import { expect, expectNoHorizontalScroll, test } from './helpers';

const UPGRADE = 'https://ezychat.ai/#enterprise';

test('Lite offers Upgrade to Enterprise at its limits, in the admin menu and in About', async ({
  page,
}) => {
  for (const [path, text] of [
    ['/admin/members', 'Need more AI agents?'],
    ['/admin/whatsapp', 'Need more WhatsApp numbers?'],
  ] as const) {
    await page.goto(path);
    const note = page.getByTestId('upgrade-note');
    await expect(note).toContainText(text);
    const link = note.getByRole('link', { name: 'Upgrade to Enterprise', exact: true });
    await expect(link).toHaveAttribute('href', UPGRADE);
    await expect(link).toHaveAttribute('target', '_blank');
  }

  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/admin/members');
  await expect(page.getByTestId('upgrade-note')).toBeVisible();
  await expectNoHorizontalScroll(page, 'members with the upgrade note');

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Account menu' }).first().click();
  await expect(
    page.getByRole('menuitem', { name: 'Upgrade to Enterprise', exact: true }),
  ).toHaveAttribute('href', UPGRADE);
  await page.getByRole('menuitem', { name: /^About/ }).click();
  const about = page.getByTestId('about-upgrade');
  await expect(about).toContainText('with support from Anchor Sprint');
  await expect(about.getByRole('link', { name: 'Upgrade to Enterprise' })).toHaveAttribute(
    'href',
    UPGRADE,
  );
});
