import { expect, test, expectNoHorizontalScroll } from './helpers';

// Never contacts OpenAI/ChatGPT: the saved key is a placeholder and "Try it" runs only while the
// Business context is empty, where the server hands off without calling a model.
test('admin sets up the AI connection inline and builds the AI member page on desktop and mobile', async ({
  page,
}, info) => {
  // One inbox-wide connection/member shared by the projects; exercise both viewports once.
  test.skip(info.project.name !== 'desktop-chromium');
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 360, height: 780 },
  ]) {
    const tag = String(viewport.width);
    await page.setViewportSize(viewport);

    // Settings → AI is an inline section: switch, key, model, one Save.
    await page.goto('/admin/settings/ai');
    await expect(page.getByText('Connection mode', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: /ChatGPT/ })).toBeVisible();
    await page.getByText('API key', { exact: true }).first().click();
    // On the second viewport the key is already saved: replacing it reopens the field.
    const replace = page.getByRole('button', { name: 'Replace key' });
    if (await replace.isVisible()) await replace.click();
    await page
      .getByLabel('OpenAI API key', { exact: true })
      .fill('test-key-not-a-real-provider-credential');
    await page.getByRole('button', { name: 'Advanced: choose a model' }).click();
    await page.getByLabel('Model (optional)', { exact: true }).fill('gpt-4.1-mini');
    await page.getByRole('button', { name: 'Save AI connection', exact: true }).click();
    await expect(page.getByText('OpenAI API key is saved.', { exact: false })).toBeVisible();
    // The saved key is never shown again: the field becomes a 'saved' note with Replace.
    await expect(page.getByLabel('OpenAI API key', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Replace key' })).toBeVisible();
    await expectNoHorizontalScroll(page, `settings/ai ${tag}`);

    // Members lists the AI member (or offers to add it) and opens the page, not a popup.
    await page.goto('/admin/members');
    await page.getByText(/\d+ of \d+ members?/).waitFor();
    const add = page.getByRole('link', { name: 'Add AI member', exact: true });
    if (await add.isVisible()) await add.click();
    else
      await page
        .getByRole('link', { name: /^Edit /, includeHidden: false })
        .filter({ visible: true })
        .first()
        .click();
    await expect(page).toHaveURL(/\/admin\/members\/ai$/);
    await expect(page.getByRole('heading', { name: /\S/ }).first()).toBeVisible();

    // Name and instructions.
    await page.getByLabel('AI member name', { exact: true }).fill('Sales Agent');
    await page
      .getByLabel('AI instructions', { exact: true })
      .fill('Answer politely in the customer’s language.');

    // Turn on is guarded until there is business context.
    const turnOn = page.getByRole('button', { name: 'Turn on', exact: true });
    await expect(turnOn).toBeDisabled();
    await expect(page.getByText('Add business context first.', { exact: true })).toBeVisible();

    // Try it with empty context: the server answers "hand off" without calling a model.
    await page.getByLabel('Customer question', { exact: true }).fill('How much is delivery?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByText('Would hand off', { exact: true })).toBeVisible();

    // Add text content (this saves the draft member first), then upload a file.
    const textName = `Delivery ${tag}`;
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Add text content', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(textName);
    await dialog
      .getByLabel('Text content', { exact: true })
      .fill('We open Monday to Friday, 9am to 5pm. Delivery costs RM10.');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByText(textName, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();

    const fileName = `business-${tag}.md`;
    await page.getByTestId('ai-context-file').setInputFiles({
      name: fileName,
      mimeType: 'text/markdown',
      buffer: Buffer.from('# FAQ\nDelivery costs RM10.'),
    });
    await expect(
      page.getByText(fileName, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();

    // With context and a saved key the guard lifts (not clicked: the AI must not claim e2e chats).
    await expect(turnOn).toBeEnabled();

    // Search narrows the list.
    await page.getByRole('button', { name: 'Search business context', exact: true }).click();
    await page.getByPlaceholder('Search by name').fill(textName);
    await expect(page.getByText(fileName, { exact: true }).filter({ visible: true })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: 'Search business context', exact: true }).click();

    await expectNoHorizontalScroll(page, `members/ai ${tag}`);

    // Clean up with Select → Delete so reruns start empty.
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByRole('checkbox', { name: `Select ${textName}` }).check();
    await page.getByRole('checkbox', { name: `Select ${fileName}` }).check();
    await page.getByRole('button', { name: 'Delete 2', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(page.getByText(textName, { exact: true })).toHaveCount(0);
  }
});
