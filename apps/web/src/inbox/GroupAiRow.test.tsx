import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AiGroupChat, AiGroupSetting } from '@ezychat/shared';
import { GroupAiBadge, GroupAiRow } from './GroupAiRow';

const GROUP = '120363000000000001@g.us';
const URL = `/api/chats/${encodeURIComponent(GROUP)}/ai-group`;

const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });

const state = (patch: Partial<AiGroupChat> = {}): AiGroupChat => ({
  enabled: false,
  setting: 'off',
  mode: 'off',
  agentId: 3,
  agentName: 'Aina',
  agentMode: 'tag',
  agentScope: 'selected',
  agentEnabled: true,
  agentAnswersGroups: true,
  paused: false,
  ...patch,
});
const tagged = (patch: Partial<AiGroupChat> = {}) =>
  state({ enabled: true, setting: 'default', mode: 'tag', ...patch });

type Call = { url: string; method: string; body: unknown };

function stubServer(start: AiGroupChat | null, putCode = 200) {
  let current = start;
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url !== URL || !current)
        return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      if (method === 'PUT') {
        if (putCode !== 200)
          return json({ error: { code: 'forbidden', message: 'Admins only' } }, putCode);
        const setting = (body as { setting: AiGroupSetting }).setting;
        const mode =
          setting === 'off' ? 'off' : setting === 'default' ? current.agentMode : setting;
        current = { ...current, setting, mode, enabled: mode !== 'off' };
      }
      return json(current);
    }),
  );
  return calls;
}

function renderRow(isAdmin: boolean) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GroupAiRow jid={GROUP} isAdmin={isAdmin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const TITLE = 'AI agent in this group';

// Radix Select needs pointer capture and scrollIntoView, which jsdom lacks.
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Group info → AI agent row', () => {
  it('lets an admin put the group in Open chat with a PUT of only { setting }', async () => {
    const calls = stubServer(state());
    renderRow(true);
    const choice = await screen.findByRole('combobox', { name: TITLE });
    expect(choice.textContent).toBe('Off');
    expect(screen.getByText('Aina does not answer in this group.')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(choice);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      "Aina's default (Tag and quote)",
      'Open chat',
      'Tag and quote',
      'Off',
    ]);
    await user.click(screen.getByRole('option', { name: 'Open chat' }));
    await waitFor(() => expect(choice.textContent).toBe('Open chat'));
    expect(calls.find((c) => c.method === 'PUT')).toEqual({
      url: URL,
      method: 'PUT',
      body: { setting: 'open' },
    });
    expect(screen.getByText(/Aina answers questions about your business/)).toBeTruthy();
    expect(screen.queryByText('Only admins can change this.')).toBeNull();
  });

  it('explains Tag and quote', async () => {
    stubServer(tagged());
    renderRow(true);
    expect(
      await screen.findByText(
        'Aina answers only when a member @mentions your number or quotes an AI message.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: TITLE }).textContent).toBe(
      "Aina's default (Tag and quote)",
    );
  });

  it('shows agents the mode read only', async () => {
    stubServer(tagged({ setting: 'open', mode: 'open' }));
    renderRow(false);
    expect((await screen.findByTestId('group-ai-state')).textContent).toBe('Open chat');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Only admins can change this.')).toBeTruthy();
    expect(screen.getByRole('region', { name: TITLE })).toBeTruthy();
  });

  it('shows Off to agents while the agent does not answer groups', async () => {
    stubServer(tagged({ agentAnswersGroups: false }));
    renderRow(false);
    expect((await screen.findByTestId('group-ai-state')).textContent).toBe('Off');
    // Agents get no link to the agent page.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it("is disabled with a hint and a link while the agent's Answer in groups is off", async () => {
    stubServer(tagged({ agentAnswersGroups: false }));
    renderRow(true);
    const choice = await screen.findByRole('combobox', { name: TITLE });
    expect(choice.hasAttribute('disabled')).toBe(true);
    expect(choice.textContent).toBe('Off');
    expect(
      screen.getByText(/Answer in groups is off for Aina. Turn it on on the agent page first./),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Aina' }).getAttribute('href')).toBe(
      '/admin/members/ai/3',
    );
  });

  it('says the agent itself is off (before its Answer in groups switch)', async () => {
    stubServer(tagged({ agentEnabled: false, agentAnswersGroups: false }));
    renderRow(true);
    const choice = await screen.findByRole('combobox', { name: TITLE });
    expect(choice.hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByText(/Aina is off. Nothing is answered in groups until you turn Aina on./),
    ).toBeTruthy();
    expect(screen.queryByText(/Answer in groups is off/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Aina' }).getAttribute('href')).toBe(
      '/admin/members/ai/3',
    );
  });

  it('says when no AI agent works in the inbox', async () => {
    stubServer(state({ agentId: null, agentName: null, agentAnswersGroups: false }));
    renderRow(true);
    expect(await screen.findByText('No AI agent works in this inbox.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: TITLE }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('explains the loop guard pause', async () => {
    stubServer(tagged({ paused: true }));
    renderRow(true);
    expect(
      await screen.findByText(
        'Paused: many answers in a row. A teammate’s message starts it again.',
      ),
    ).toBeTruthy();
  });

  it('keeps the choice when the save is refused', async () => {
    const calls = stubServer(state(), 403);
    renderRow(true);
    const choice = await screen.findByRole('combobox', { name: TITLE });
    const user = userEvent.setup();
    await user.click(choice);
    await user.click(screen.getByRole('option', { name: 'Tag and quote' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    await waitFor(() => expect(choice.hasAttribute('disabled')).toBe(false));
    expect(choice.textContent).toBe('Off');
  });

  it('renders nothing when the server has no answer for the group', async () => {
    const calls = stubServer(null);
    const { container } = renderRow(true);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container.textContent).toBe('');
  });
});

describe('GroupAiBadge', () => {
  it('names the mode while the AI answers the group, and says when it is paused', () => {
    const { rerender, container } = render(<GroupAiBadge ai={tagged()} />);
    expect(screen.getByTestId('group-ai-badge').textContent).toBe(
      'AI answers when tagged or quoted',
    );
    rerender(<GroupAiBadge ai={tagged({ setting: 'open', mode: 'open' })} />);
    expect(screen.getByTestId('group-ai-badge').textContent).toBe('AI in open chat');
    rerender(<GroupAiBadge ai={tagged({ paused: true })} />);
    expect(screen.getByTestId('group-ai-badge').textContent).toBe('AI paused');
    rerender(<GroupAiBadge ai={tagged({ agentAnswersGroups: false })} />);
    expect(container.textContent).toBe('');
    rerender(<GroupAiBadge ai={state()} />);
    expect(container.textContent).toBe('');
    rerender(<GroupAiBadge ai={null} />);
    expect(container.textContent).toBe('');
  });
});
