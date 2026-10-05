import { expect, test } from './helpers';

test('admin configures one shared AI connection and manages the Sales Agent knowledge on desktop and mobile', async ({
  page,
}, info) => {
  // One inbox-wide connection/member shared by the projects; exercise both viewports once.
  test.skip(info.project.name !== 'desktop-chromium');
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 360, height: 780 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/admin/settings');
    await page.getByRole('button', { name: 'Configure AI connection', exact: true }).click();
    const connection = page.getByRole('dialog');
    await expect(
      connection.getByRole('heading', { name: 'Inbox AI connection', exact: true }),
    ).toBeVisible();
    await connection
      .getByLabel('OpenAI API key', { exact: true })
      .fill('test-key-not-a-real-provider-credential');
    await connection.getByLabel('Model (optional)', { exact: true }).fill('gpt-4.1-mini');
    await connection.getByRole('button', { name: 'Save AI connection', exact: true }).click();
    await expect(connection.getByText('A key is saved.', { exact: false })).toBeVisible();
    await expect(connection.getByLabel('OpenAI API key', { exact: true })).toHaveValue('');
    await connection
      .getByRole('button', { name: 'Close', exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page.goto('/admin/members');
    await page.getByText(/\d+ of \d+ members?/).waitFor();
    const add = page.getByRole('button', { name: 'Add AI member', exact: true });
    if (await add.isVisible()) await add.click();
    else if (viewport.width < 768)
      await page.getByRole('button', { name: 'Edit Sales Agent', exact: true }).click();
    else
      await page
        .locator('tr')
        .filter({ hasText: 'Sales Agent' })
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
    const member = page.getByRole('dialog');
    await member.getByLabel('AI member name', { exact: true }).fill('Sales Agent');
    await member
      .getByLabel('AI instructions', { exact: true })
      .fill('Answer politely in the customer’s language.');
    await member
      .getByLabel('Business context', { exact: true })
      .fill('We open Monday to Friday, 9am to 5pm. Delivery costs RM10.');
    await member.getByRole('button', { name: 'Save AI member', exact: true }).click();
    await expect(member.getByText('Attach files', { exact: true })).toBeVisible();
    await member.locator('input[type=file]').setInputFiles({
      name: `business-${viewport.width}.md`,
      mimeType: 'text/markdown',
      buffer: Buffer.from('# FAQ\nDelivery costs RM10.'),
    });
    await expect(member.getByText(`business-${viewport.width}.md`, { exact: true })).toBeVisible();
    await member
      .getByRole('button', { name: 'Close', exact: true })
      .filter({ visible: true })
      .first()
      .click();
    const identity = page
      .getByText('Sales Agent', { exact: true })
      .filter({ visible: true })
      .first();
    await expect(identity).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});
