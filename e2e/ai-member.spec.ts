import { expect, test, expectNoHorizontalScroll } from './helpers';

// Never contacts OpenAI/ChatGPT: the saved key is a placeholder and "Try it" runs only while the
// Business context is empty, where the server hands off without calling a model.
test('admin sets up the AI connection inline and builds an AI agent page on desktop and mobile', async ({
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
    // Save tests a new key first; answer that check here so OpenAI is never contacted.
    await page.route('**/api/ai/connection/test', (route) =>
      route.fulfill({ json: { ok: true, error: null } }),
    );

    // Settings → AI is an inline section: switch, key, model, one Save. ChatGPT is listed first.
    await page.goto('/admin/settings/ai');
    await expect(page.getByText('Connection mode', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio').first()).toHaveAccessibleName(/ChatGPT/);
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
    // A saved connection points to the agent page: a new agent first, then the existing one.
    await expect(page.getByRole('link', { name: 'Set up your AI agent' })).toHaveAttribute(
      'href',
      /^\/admin\/members\/ai\/(new|\d+)$/,
    );
    await expectNoHorizontalScroll(page, `settings/ai ${tag}`);

    // Members lists the AI agent (or offers to add one: Lite has one) and opens its page, not a popup.
    await page.goto('/admin/members');
    await page.getByText(/\d+ of \d+ members?/).waitFor();
    const add = page.getByRole('link', { name: 'Add AI agent', exact: true });
    if (await add.isVisible()) {
      await add.click();
      await expect(page).toHaveURL(/\/admin\/members\/ai\/new/);
      // A new agent starts from a preset; the FAQ preset never sells.
      await page.getByRole('radio', { name: /FAQ/ }).check();
      await page.getByLabel('Agent name', { exact: true }).fill('Help desk');
      // The create page is short: Business context and Try it come once the agent exists.
      await expect(
        page.getByText(
          'After you create the agent, add its Business context, try it and turn it on.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.getByText('Try it', { exact: true })).toHaveCount(0);
      await expectNoHorizontalScroll(page, `members/ai/new ${tag}`);
      await page.getByRole('button', { name: 'Create agent', exact: true }).click();
    } else
      await page
        .getByRole('link', { name: /^Edit /, includeHidden: false })
        .filter({ visible: true })
        .first()
        .click();
    await expect(page).toHaveURL(/\/admin\/members\/ai\/\d+$/);
    await expect(page.getByRole('heading', { name: /\S/ }).first()).toBeVisible();
    await expect(page.getByTestId('preset-badge').filter({ visible: true }).first()).toHaveText(
      'FAQ agent',
    );

    // Name and role (the role lives in the closed Advanced section).
    await page.getByLabel('Agent name', { exact: true }).fill('Help desk');
    const advanced = page.getByText('Advanced: role and hand-over rules', { exact: true });
    // Closed for a saved agent; a restored unsaved draft (the second viewport) opens it.
    if (!(await page.getByLabel('Role (instructions)', { exact: true }).isVisible()))
      await advanced.click();
    await page
      .getByLabel('Role (instructions)', { exact: true })
      .fill('Answer politely in the customer’s language.');

    // Edit with AI opens a review dialog. Suggest is never pressed: it would call a model.
    const instructionsCard = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]', { hasText: /^Role$/ }),
    });
    await instructionsCard.getByRole('button', { name: 'Edit with AI', exact: true }).click();
    const editDialog = page.getByRole('dialog');
    await expect(
      editDialog.getByText('Edit AI instructions with AI', { exact: true }),
    ).toBeVisible();
    await expect(editDialog.getByRole('button', { name: 'Suggest', exact: true })).toBeDisabled();
    await expectNoHorizontalScroll(page, `members/ai edit dialog ${tag}`);
    await editDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Role (instructions)', { exact: true })).toHaveValue(
      'Answer politely in the customer’s language.',
    );

    // Turn on is guarded until there is business context; Next steps lists what is left.
    // The header's Turn on comes first; Next steps repeats it.
    const turnOn = page.getByRole('button', { name: 'Turn on', exact: true }).first();
    await expect(turnOn).toBeDisabled();
    await expect(page.getByText('Needs business context', { exact: true })).toBeVisible();
    const nextSteps = page.getByTestId('next-steps');
    await expect(nextSteps.getByText('Next steps', { exact: true })).toBeVisible();
    await expect(nextSteps.getByRole('button', { name: 'Turn on', exact: true })).toBeDisabled();

    // Try it with empty context: the server answers "hand off" without calling a model.
    await page.getByLabel('Customer question', { exact: true }).fill('How much is delivery?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByText('Would hand off', { exact: true })).toBeVisible();

    // Add an Internal text item (used to decide, never told to customers), then upload a file.
    const textName = `Prices ${tag}`;
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Add text content', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(textName);
    await dialog
      .getByLabel('Text content', { exact: true })
      .fill('Lowest price we accept: RM80. Never give a discount above 10%.');
    await dialog.getByRole('switch', { name: 'Internal' }).click();
    await expect(dialog.getByRole('switch', { name: 'Internal' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByText(textName, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('internal-badge').filter({ visible: true })).toHaveCount(1);

    const fileName = `business-${tag}.md`;
    await page.getByTestId('ai-context-file').setInputFiles({
      name: fileName,
      mimeType: 'text/markdown',
      buffer: Buffer.from('# FAQ\nDelivery costs RM10.'),
    });
    // The file dialog offers the Internal switch; this file is customer-facing, so it stays off.
    const fileDialog = page.getByRole('dialog', { name: 'Add a file' });
    await expect(fileDialog.getByRole('switch', { name: 'Internal' })).not.toBeChecked();
    await fileDialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
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
