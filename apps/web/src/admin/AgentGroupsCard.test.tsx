import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AiAgentGroups, AiGroupChat, AiGroupRow } from '@ezychat/shared';
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
  ...patch,
});

const GROUPS = [
  row(KOPI, 'Kopi Lovers Club', { enabled: true }),
  row(RESELLERS, 'Reseller Group Penang with a very long name that wraps on a phone', {
    memberCount: null,
  }),
];

type Call = { url: string; method: string; body: unknown };

/** A stand-in server for the agent's groups and each group's switch. */
function stubServer(start: AiAgentGroups, fail = false) {
  let state = structuredClone(start);
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (fail && method === 'PUT')
        return json({ error: { code: 'internal', message: 'Boom' } }, 500);
      if (url === '/api/ai/agents/3/groups') {
        if (method === 'PUT') state = { ...state, enabled: (body as { enabled: boolean }).enabled };
        return json(state);
      }
      const chat = /^\/api\/chats\/([^/]+)\/ai-group$/.exec(url);
      if (chat && method === 'PUT') {
        const jid = decodeURIComponent(chat[1]!);
        const enabled = (body as { enabled: boolean }).enabled;
        state = {
          ...state,
          groups: state.groups.map((g) => (g.jid === jid ? { ...g, enabled } : g)),
        };
        const saved: AiGroupChat = {
          enabled,
          agentId: 3,
          agentName: 'Aina',
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
  groups: GROUPS,
  loopGuard: 10,
  inboxName: null,
  ...patch,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Agent page → Groups', () => {
  it('lists the groups with their state, links and the limits when answering is on', async () => {
    stubServer(data());
    renderCard();
    const list = await screen.findByRole('list', { name: 'Groups of Kopi Apong' });
    expect(
      screen.getByText('Aina can answer in the groups of your WhatsApp number (Kopi Apong).'),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole('switch', {
          name: 'Answer in groups (when tagged or quoted)',
        }) as HTMLElement
      ).getAttribute('aria-checked'),
    ).toBe('true');
    const kopi = screen.getByRole('link', { name: 'Open Kopi Lovers Club' });
    expect(kopi.getAttribute('href')).toBe(`/chats/${encodeURIComponent(KOPI)}`);
    expect(kopi.textContent).toContain('24 members · Answers when tagged or quoted');
    // No member count from WhatsApp: only the state.
    const long = screen.getByRole('link', { name: /Open Reseller Group Penang/ });
    expect(long.textContent?.endsWith('Off')).toBe(true);
    expect(long.textContent).not.toContain('members');
    expect(within(list).getAllByRole('switch')).toHaveLength(2);
    expect(
      screen.getByText(
        'Loop guard: after 10 answers in a row with no teammate message, Aina pauses in that group until a teammate writes.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/In groups, Aina only looks things up/)).toBeTruthy();
    expect(screen.queryByTestId('groups-none-on')).toBeNull();
  });

  it('marks a group the loop guard paused', async () => {
    stubServer(data({ groups: [row(KOPI, 'Kopi Lovers Club', { enabled: true, paused: true })] }));
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

  it('switches one group with a PUT of only { enabled }', async () => {
    const calls = stubServer(data());
    renderCard();
    const user = userEvent.setup();
    const sw = await screen.findByRole('switch', {
      name: /Answer in Reseller Group Penang/,
    });
    await user.click(sw);
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toEqual({
      url: `/api/chats/${encodeURIComponent(RESELLERS)}/ai-group`,
      method: 'PUT',
      body: { enabled: true },
    });
    expect(screen.getByRole('link', { name: /Open Reseller Group Penang/ }).textContent).toContain(
      'Answers when tagged or quoted',
    );
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
    await userEvent
      .setup()
      .click(screen.getByRole('switch', { name: 'Answer in groups (when tagged or quoted)' }));
    expect(await screen.findByRole('list', { name: 'Groups of Kopi Apong' })).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')).toEqual({
      url: '/api/ai/agents/3/groups',
      method: 'PUT',
      body: { enabled: true },
    });
  });

  it('says no group is switched on yet', async () => {
    stubServer(data({ groups: GROUPS.map((g) => ({ ...g, enabled: false })) }));
    renderCard();
    expect(
      await screen.findByText('No group is switched on yet, so Aina answers in no group.'),
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
    const sw = await screen.findByRole('switch', {
      name: 'Answer in groups (when tagged or quoted)',
    });
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
