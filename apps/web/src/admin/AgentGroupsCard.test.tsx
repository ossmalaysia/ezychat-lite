import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AiAgentGroups, AiGroupChat, AiGroupRow, AiGroupSetting } from '@ezychat/shared';
import { AgentGroupsCard } from './AgentGroupsCard';

const KOPI = '120363000000000001@g.us';
const RESELLERS = '120363000000000002@g.us';

const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });

const row = (jid: string, name: string, patch: Partial<AiGroupRow> = {}): AiGroupRow => ({
  jid,
  name,
  memberCount: 24,
  paused: false,
  enabled: false,
  setting: 'off',
  mode: 'off',
  ...patch,
});

const GROUPS = [
  row(KOPI, 'Kopi Lovers Club', { enabled: true, setting: 'default', mode: 'tag' }),
  row(RESELLERS, 'Reseller Group Penang with a very long name that wraps on a phone', {
    memberCount: null,
  }),
];

type Call = { url: string; method: string; body: unknown };

/** How the stand-in server resolves a group's mode (as the real one does). */
const modeOf = (setting: AiGroupSetting, agentMode: 'tag' | 'open') =>
  setting === 'off' ? 'off' : setting === 'default' ? agentMode : setting;

/** A stand-in server for the agent's group settings and each group's choice. */
function stubServer(start: AiAgentGroups, fail = false) {
  let state = structuredClone(start);
  const calls: Call[] = [];
  const resolve = () => {
    state = {
      ...state,
      groups: state.groups.map((g) => {
        const mode = modeOf(g.setting, state.mode);
        return { ...g, mode, enabled: mode !== 'off' };
      }),
    };
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (fail && method === 'PUT')
        return json({ error: { code: 'internal', message: 'Boom' } }, 500);
      if (url === '/api/ai/agents/3/groups') {
        if (method === 'PUT') {
          state = { ...state, ...(body as Partial<AiAgentGroups>) };
          resolve();
        }
        return json(state);
      }
      const chat = /^\/api\/chats\/([^/]+)\/ai-group$/.exec(url);
      if (chat && method === 'PUT') {
        const jid = decodeURIComponent(chat[1]!);
        const setting = (body as { setting: AiGroupSetting }).setting;
        state = {
          ...state,
          groups: state.groups.map((g) => (g.jid === jid ? { ...g, setting } : g)),
        };
        resolve();
        const mode = modeOf(setting, state.mode);
        const saved: AiGroupChat = {
          enabled: mode !== 'off',
          setting,
          mode,
          agentId: 3,
          agentName: 'Aina',
          agentMode: state.mode,
          agentScope: state.scope,
          agentEnabled: true,
          agentAnswersGroups: state.enabled,
          paused: false,
        };
        return json(saved);
      }
      return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    }),
  );
  return calls;
}

function renderCard(props: Partial<Parameters<typeof AgentGroupsCard>[0]> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AgentGroupsCard agentId={3} name="Aina" agentEnabled inboxName="Kopi Apong" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const data = (patch: Partial<AiAgentGroups> = {}): AiAgentGroups => ({
  enabled: true,
  scope: 'selected',
  mode: 'tag',
  groups: GROUPS,
  loopGuard: 10,
  inboxName: null,
  ...patch,
});

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

describe('Agent page → Groups', () => {
  it('shows which groups, the default mode, each group with its choice, and the rules', async () => {
    stubServer(data());
    renderCard();
    const list = await screen.findByRole('list', { name: 'Groups of Kopi Apong' });
    expect(
      screen.getByText('Aina can answer in the groups of your WhatsApp number (Kopi Apong).'),
    ).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: 'Answer in groups' }).getAttribute('aria-checked'),
    ).toBe('true');
    const scope = within(screen.getByTestId('groups-scope'));
    expect(
      scope.getByRole('radio', { name: /Selected groups only/ }).getAttribute('aria-checked'),
    ).toBe('true');
    const mode = within(screen.getByTestId('groups-mode'));
    expect(mode.getByRole('radio', { name: /Tag and quote/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    const kopi = screen.getByRole('link', { name: 'Open Kopi Lovers Club' });
    expect(kopi.getAttribute('href')).toBe(`/chats/${encodeURIComponent(KOPI)}`);
    expect(kopi.textContent).toContain('24 members · Tag and quote');
    // No member count from WhatsApp: only the state.
    const long = screen.getByRole('link', { name: /Open Reseller Group Penang/ });
    expect(long.textContent?.endsWith('Off')).toBe(true);
    expect(long.textContent).not.toContain('members');
    const choices = within(list).getAllByRole('combobox');
    expect(choices.map((c) => c.textContent)).toEqual(['Default (Tag and quote)', 'Off']);
    expect(
      screen.getByText(/Aina never discusses politics, race, religion or gender/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Loop guard: after 10 answers in a row with no teammate message, Aina pauses in that group until a teammate writes.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/In groups, Aina only looks things up/)).toBeTruthy();
    expect(screen.queryByTestId('groups-none-on')).toBeNull();
    // No group is in Open chat: no cost line.
    expect(screen.queryByTestId('open-chat-cost')).toBeNull();
  });

  it('marks a group the loop guard paused', async () => {
    stubServer(
      data({
        groups: [
          row(KOPI, 'Kopi Lovers Club', {
            enabled: true,
            setting: 'default',
            mode: 'tag',
            paused: true,
          }),
        ],
      }),
    );
    renderCard();
    const kopi = await screen.findByRole('link', { name: 'Open Kopi Lovers Club' });
    expect(kopi.textContent).toContain('24 members · Paused: many answers in a row');
    expect(kopi.querySelector('.text-warning')).toBeTruthy();
  });

  it('names the inbox the server reports, without the inbox list', async () => {
    const calls = stubServer(data({ inboxName: 'Sales line' }));
    renderCard({ inboxName: 'WhatsApp' });
    expect(await screen.findByRole('list', { name: 'Groups of Sales line' })).toBeTruthy();
    expect(
      screen.getByText('Aina can answer in the groups of your WhatsApp number (Sales line).'),
    ).toBeTruthy();
    expect(calls.some((c) => c.url.startsWith('/api/inboxes'))).toBe(false);
  });

  it('puts one group in Open chat with a PUT of only { setting } and shows the cost line', async () => {
    const calls = stubServer(data());
    renderCard();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: /AI in Reseller Group Penang/ }));
    await user.click(screen.getByRole('option', { name: 'Open chat' }));
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: /Open Reseller Group Penang/ }).textContent,
      ).toContain('Open chat'),
    );
    expect(calls.find((c) => c.method === 'PUT')).toEqual({
      url: `/api/chats/${encodeURIComponent(RESELLERS)}/ai-group`,
      method: 'PUT',
      body: { setting: 'open' },
    });
    expect(screen.getByTestId('open-chat-cost').textContent).toBe(
      'In open chat, Aina reads each new group message to decide if it should answer: one short AI call per message.',
    );
  });

  it('changes which groups and the default mode with a PUT of only that field', async () => {
    const calls = stubServer(data());
    renderCard();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: /All groups/ }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /All groups/ }).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
    await user.click(screen.getByRole('radio', { name: /Open chat/ }));
    // The Default group follows the new default mode.
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Open Kopi Lovers Club' }).textContent).toContain(
        'Open chat',
      ),
    );
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
      { scope: 'all' },
      { mode: 'open' },
    ]);
    const kopiChoice = screen.getAllByRole('combobox')[0]!;
    expect(kopiChoice.textContent).toBe('Default (Open chat)');
  });

  it('is off by default: a summary, and turning it on PUTs { enabled: true } and shows the list', async () => {
    const calls = stubServer(data({ enabled: false }));
    renderCard();
    expect(
      await screen.findByText(
        'Kopi Apong is in 2 groups. Turn this on to choose where Aina answers.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Groups of Kopi Apong' })).toBeNull();
    expect(screen.queryByTestId('groups-scope')).toBeNull();
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Answer in groups' }));
    expect(await screen.findByRole('list', { name: 'Groups of Kopi Apong' })).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')).toEqual({
      url: '/api/ai/agents/3/groups',
      method: 'PUT',
      body: { enabled: true },
    });
  });

  it('says no group is on yet', async () => {
    stubServer(
      data({ groups: GROUPS.map((g) => ({ ...g, enabled: false, setting: 'off', mode: 'off' })) }),
    );
    renderCard();
    expect(
      await screen.findByText('No group is on yet, so Aina answers in no group.'),
    ).toBeTruthy();
  });

  it('shows the empty state for an inbox without groups', async () => {
    stubServer(data({ groups: [] }));
    renderCard();
    expect(
      await screen.findByText(
        'Kopi Apong is not in any WhatsApp group yet. Groups show here when the number is added to one.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('warns that nothing is answered while the agent itself is off', async () => {
    stubServer(data());
    renderCard({ agentEnabled: false });
    expect(
      await screen.findByText('Aina is off. Nothing is answered in groups until you turn Aina on.'),
    ).toBeTruthy();
  });

  it('asks for an inbox first when the agent answers no inbox', async () => {
    stubServer(data());
    renderCard({ inboxName: null });
    expect(await screen.findByText('Choose an inbox for Aina first.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('keeps the switch as it was when saving fails', async () => {
    const calls = stubServer(data({ enabled: false }), true);
    renderCard();
    const sw = await screen.findByRole('switch', { name: 'Answer in groups' });
    await userEvent.setup().click(sw);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    await waitFor(() => expect(sw.hasAttribute('disabled')).toBe(false));
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('offers Retry when the groups cannot load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'internal', message: 'Boom' } }, 500)),
    );
    renderCard();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
