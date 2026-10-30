import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AiAgentGroups } from '@ezychat/shared';
import { AgentDirectCard } from './AgentDirectCard';
import { agentGroupsData, json, renderWithQuery } from './agent-cards.test.helpers';

const data = (patch: Partial<AiAgentGroups> = {}) =>
  agentGroupsData({ inboxName: 'Kopi Apong', ...patch });

type Call = { url: string; method: string; body: unknown };

/** A stand-in server for the agent's groups view and its "Answer direct chats" switch. */
function stubServer(start: AiAgentGroups, fail = false) {
  let state = structuredClone(start);
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url === '/api/ai/agents/3/groups' && method === 'GET') return json(state);
      if (url === '/api/ai/agents/3/direct' && method === 'PUT') {
        if (fail) return json({ error: { code: 'internal', message: 'Boom' } }, 500);
        const enabled = (body as { enabled: boolean }).enabled;
        state = { ...state, answerDirect: enabled, heldDirect: enabled ? state.heldDirect : 0 };
        return json(state);
      }
      if (url === '/api/users/directory') return json({ users: [] });
      return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    }),
  );
  return calls;
}

function renderCard(inboxName: string | null = 'Kopi Apong') {
  renderWithQuery(<AgentDirectCard agentId={3} name="Aina" inboxName={inboxName} />);
}

const checked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true';
const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AgentDirectCard', () => {
  it('shows the switch on by default and turns it off at once when the agent holds no chat', async () => {
    const calls = stubServer(data());
    renderCard();
    const toggle = await screen.findByRole('switch', { name: 'Answer direct chats' });
    expect(checked(toggle)).toBe(true);
    screen.getByText('Customers who message Kopi Apong one to one.');
    await userEvent.click(toggle);
    await waitFor(() => expect(checked(toggle)).toBe(false));
    expect(puts(calls)).toEqual([
      { url: '/api/ai/agents/3/direct', method: 'PUT', body: { enabled: false } },
    ]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // Answer in groups is on: a group-only agent.
    expect(screen.getByTestId('direct-group-only').textContent).toContain(
      'Aina answers only in groups',
    );
  });

  it('asks before returning the chats the agent holds, and Cancel keeps the switch on', async () => {
    const calls = stubServer(data({ heldDirect: 2 }));
    renderCard();
    const toggle = await screen.findByRole('switch', { name: 'Answer direct chats' });
    await userEvent.click(toggle);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Stop Aina answering direct chats?');
    expect(dialog.textContent).toContain('Aina is handling 2 open direct chats.');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(puts(calls)).toHaveLength(0);
    expect(checked(toggle)).toBe(true);

    await userEvent.click(toggle);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(checked(toggle)).toBe(false);
    expect(puts(calls)).toHaveLength(1);
  });

  it('warns when the agent answers no chats, and turns direct chats back on', async () => {
    const calls = stubServer(data({ enabled: false, answerDirect: false }));
    renderCard();
    expect((await screen.findByTestId('direct-none')).textContent).toContain(
      'Aina answers no chats.',
    );
    await userEvent.click(screen.getByRole('switch', { name: 'Answer direct chats' }));
    await waitFor(() => expect(screen.queryByTestId('direct-none')).toBeNull());
    expect(puts(calls)[0]!.body).toEqual({ enabled: true });
  });

  it('keeps the switch as it was when saving fails', async () => {
    stubServer(data(), true);
    renderCard();
    const toggle = await screen.findByRole('switch', { name: 'Answer direct chats' });
    await userEvent.click(toggle);
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    expect(checked(toggle)).toBe(true);
  });

  it('is hidden without groups (Business API inbox) and without an inbox', async () => {
    const calls = stubServer(data({ directAvailable: false }));
    renderCard();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByTestId('agent-direct')).toBeNull());
    cleanup();
    renderCard(null);
    expect(screen.queryByTestId('agent-direct')).toBeNull();
  });
});
