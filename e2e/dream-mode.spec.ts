import { expect, expectNoHorizontalScroll, firstAgent, inboxHeading, test } from './helpers';

/**
 * Agent page → Dream mode (docs/superpowers/specs/2026-11-14-dream-mode-design.md): the switches save at once, a
 * night seeded through the dev route shows in the history, See change shows the texts, Apply writes the new text and
 * Undo brings the old one back. No model is called (the night is seeded). Lite has one shared agent, so only the
 * desktop project changes it, and the end switches dream mode off again; the phone project checks the layout.
 */
const DESKTOP = 'desktop-chromium';

test('Dream mode: switches, a night in the history, See change, Apply and Undo', async ({
  page,
  baseURL,
}, info) => {
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  const agent = await firstAgent(page);
  const origin = { Origin: new URL(baseURL!).origin };
  const desktop = info.project.name === DESKTOP;
  try {
    if (desktop) {
      await page.goto(`/admin/members/ai/${agent.id}`);
      const card = page.getByTestId('agent-dream');
      await card.getByRole('switch', { name: 'Dream mode' }).click();
      await expect(card.getByRole('switch', { name: 'Apply by itself' })).toBeVisible();
      await card.getByRole('switch', { name: 'Apply by itself' }).click();
      await expect(card.getByText(/new facts go into Business context at once/)).toBeVisible();
      await expect
        .poll(
          async () =>
            (
              (await (await page.request.get(`/api/ai/agents/${agent.id}/dream`)).json()) as {
                settings: { autoApply: boolean };
              }
            ).settings.autoApply,
        )
        .toBe(true);
      const item = 'Dream e2e hours';
      await page.request.post(`/api/dev/fake-dream-run`, {
        headers: origin,
        data: {
          agentId: agent.id,
          changes: [
            {
              target: 'context_text',
              name: item,
              before: '',
              after: 'Saturday 9 am to 1 pm.',
              summary: 'Saturday hours',
            },
          ],
        },
      });
      await page.reload();
      const row = page.getByTestId('dream-change').filter({ hasText: 'Saturday hours' }).first();
      await expect(row.getByText('Waiting for you')).toBeVisible();
      await row.getByRole('button', { name: 'See change' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Saturday 9 am to 1 pm.')).toBeVisible();
      await dialog.getByRole('button', { name: 'Apply' }).click();
      await expect(row.getByText('Applied')).toBeVisible();
      await expect(page.getByText(item).first()).toBeVisible();
      await row.getByRole('button', { name: 'Undo' }).click();
      await expect(row.getByText('Undone')).toBeVisible();
    } else {
      await page.goto(`/admin/members/ai/${agent.id}`);
      await expect(page.getByTestId('agent-dream')).toBeVisible();
    }
    await expectNoHorizontalScroll(page, 'agent page dream mode card');
  } finally {
    if (desktop)
      await page.request.put(`/api/ai/agents/${agent.id}/dream`, {
        headers: origin,
        data: { enabled: false, autoApply: false },
      });
  }
});
