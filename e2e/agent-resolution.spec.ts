import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalScroll, inboxHeading, test } from './helpers';

/**
 * Agent page → Closing chats, "Ask if the question is answered" (#230): the switch saves at once,
 * its hint follows the state, and the saved value survives a reload. No model is called (the agent
 * stays off). Lite has one shared agent, so only the desktop project changes it, and the end
 * restores the value it found.
 */
const DESKTOP = 'desktop-chromium';

async function firstAgent(page: Page): Promise<{ id: number; resolutionCheck?: boolean }> {
  type Agent = { id: number; resolutionCheck?: boolean };
  const list = async () =>
    ((await (await page.request.get('/api/ai/agents')).json()) as { agents: Agent[] }).agents;
  if (!(await list()).length) {
    await page.request.post('/api/ai/agents', {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        displayName: 'Help desk',
        enabled: false,
        preset: 'faq',
        instructions: 'Answer questions about the shop.',
        handoffRules: 'Hand over refunds.',
      },
    });
  }
  await expect.poll(async () => (await list()).length, { timeout: 30_000 }).toBeGreaterThan(0);
  return (await list())[0]!;
}

test('Ask if the question is answered: saves at once and survives a reload (desktop)', async ({
  page,
  baseURL,
}, info) => {
  test.skip(info.project.name !== DESKTOP, 'one project changes the shared agent');
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  const agent = await firstAgent(page);
  const before = agent.resolutionCheck === true;
  const saved = async () =>
    (
      (await (await page.request.get(`/api/ai/agents/${agent.id}`)).json()) as {
        agent: { resolutionCheck?: boolean };
      }
    ).agent.resolutionCheck === true;

  try {
    await page.goto(`/admin/members/ai/${agent.id}`);
    const card = page.getByTestId('agent-resolution');
    await expect(card.getByText('Closing chats', { exact: true })).toBeVisible();
    const toggle = card.getByTestId('resolution-check');
    await expect(toggle).toHaveAttribute('aria-checked', String(before));

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', String(!before));
    await expect.poll(saved).toBe(!before);
    await expect(
      card.getByText(!before ? /closes the chat when/ : /only says thanks/),
    ).toBeVisible();
    await expectNoHorizontalScroll(page, 'agent page closing chats card');

    await page.reload();
    await expect(page.getByTestId('resolution-check')).toHaveAttribute(
      'aria-checked',
      String(!before),
    );
  } finally {
    await page.request.put(`/api/ai/agents/${agent.id}/resolution-check`, {
      headers: { Origin: new URL(baseURL!).origin },
      data: { enabled: before },
    });
  }
});
