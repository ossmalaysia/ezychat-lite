import { expect, expectNoHorizontalScroll, test } from './helpers';

/**
 * The "?" tips (docs/features/concept-tips/design.md): a click opens a short card, "Show steps"
 * unfolds the steps under the buttons, Escape closes it and gives focus back to the "?". Every
 * project runs it, so the card is checked at desktop and phone width. Nothing is sent or saved.
 */
test('a "?" tip opens, shows its steps and closes with Escape', async ({ page }, info) => {
  // Settings → AI with the API key mode: the key tip has steps, an outside page and a guide.
  await page.goto('/admin/settings/ai');
  await page.getByText('OpenAI API key', { exact: true }).first().click();
  const tip = page.getByRole('button', { name: 'What is an API key?' });
  await expect(tip).toBeVisible();
  await tip.click();

  const card = page.getByRole('dialog').filter({ hasText: 'What is an API key?' });
  await expect(card).toBeVisible();
  await expect(card.getByText(/lets EzyChat use OpenAI on your account/)).toBeVisible();
  const action = card.getByRole('link', { name: 'Get a key at OpenAI' });
  await expect(action).toHaveAttribute('href', 'https://platform.openai.com/api-keys');
  await expect(action).toHaveAttribute('target', '_blank');
  // The guide link carries campaign tags only (no tracking in Lite).
  await expect(card.getByRole('link', { name: 'Full guide' })).toHaveAttribute(
    'href',
    /^https:\/\/ezychat\.ai\/guides\/set-up-ai-agent\?utm_source=ezychat-lite&utm_medium=app&utm_campaign=tip-apiKey$/,
  );

  // Steps stay folded until asked for.
  await expect(card.getByText('Sign in at platform.openai.com.')).toHaveCount(0);
  const steps = card.getByRole('button', { name: 'Show steps' });
  await steps.click();
  await expect(card.getByRole('button', { name: 'Hide steps' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(card.getByRole('listitem')).toHaveCount(4);
  await expect(card).toBeInViewport();
  await expectNoHorizontalScroll(page, `api key tip ${info.project.name}`);

  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(tip).toBeFocused();

  // Opened again, the steps are folded again.
  await tip.click();
  await expect(card.getByRole('button', { name: 'Show steps' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a tip without steps shows only its text (Settings → LAN access)', async ({ page }) => {
  await page.goto('/admin/settings');
  const tip = page.getByRole('button', { name: 'What is LAN access?' });
  await tip.click();
  const card = page.getByRole('dialog').filter({ hasText: 'What is LAN access?' });
  await expect(
    card.getByText(/Not encrypted: turn it on only on a network you trust/),
  ).toBeVisible();
  await expect(card.getByRole('button', { name: 'Show steps' })).toHaveCount(0);
  // The tip is outside the label: the LAN switch keeps its own name and state.
  await expect(page.getByRole('switch', { name: /LAN/ })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});
