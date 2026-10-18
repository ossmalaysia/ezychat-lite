import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GETTING_STARTED_HIDDEN_KEY, GettingStartedCard } from './GettingStartedCard';

const state = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'agent',
  aiOn: false,
  users: [] as { id: number; kind?: string; disabled: boolean }[],
  tunnelState: 'stopped' as string,
  hasTunnelToken: false,
  namedTunnelHostname: null as string | null,
}));

vi.mock('../api/ai', () => ({
  useAiMember: () => ({
    data: {
      member: state.aiOn ? { disabled: false } : null,
      settings: { mode: 'api' },
      hasApiKey: true,
      connection: { state: 'disconnected' },
      documents: [{ characters: 120 }],
    },
  }),
}));

vi.mock('../api/queries', () => ({
  useMe: () => ({ data: { id: 1, role: state.role } }),
  useUsers: () => ({ data: state.users }),
  useTunnel: () => ({
    data: { mode: 'off', state: state.tunnelState, url: null, hostname: null },
  }),
  useSettings: () => ({
    data: {
      hasTunnelToken: state.hasTunnelToken,
      namedTunnelHostname: state.namedTunnelHostname,
    },
  }),
}));

function renderCard() {
  return render(
    <MemoryRouter>
      <GettingStartedCard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.assign(state, {
    role: 'admin',
    aiOn: false,
    users: [{ id: 1, kind: 'human', disabled: false }],
    tunnelState: 'stopped',
    hasTunnelToken: false,
    namedTunnelHostname: null,
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GettingStartedCard', () => {
  it('shows every unfinished step to an admin with links to its admin page', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Getting started' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /AI assistant/ }).getAttribute('href')).toBe(
      '/admin/members/ai',
    );
    expect(screen.getByRole('link', { name: /Teammates/ }).getAttribute('href')).toBe(
      '/admin/members',
    );
    expect(screen.getByRole('link', { name: /Phone access/ }).getAttribute('href')).toBe(
      '/admin/tunnel',
    );
  });

  it('never shows to an agent', () => {
    state.role = 'agent';
    const { container } = renderCard();
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('hides finished items', () => {
    state.aiOn = true;
    state.users = [
      { id: 1, kind: 'human', disabled: false },
      { id: 2, kind: 'human', disabled: false },
      { id: 3, kind: 'ai', disabled: false },
    ];
    renderCard();
    expect(screen.queryByRole('link', { name: /AI assistant/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Teammates/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Phone access/ })).toBeTruthy();
  });

  it('does not count the AI member or disabled users as teammates', () => {
    state.users = [
      { id: 1, kind: 'human', disabled: false },
      { id: 2, kind: 'human', disabled: true },
      { id: 3, kind: 'ai', disabled: false },
    ];
    renderCard();
    expect(screen.getByRole('link', { name: /Teammates/ })).toBeTruthy();
  });

  it('treats a configured named tunnel as phone access done', () => {
    state.hasTunnelToken = true;
    renderCard();
    expect(screen.queryByRole('link', { name: /Phone access/ })).toBeNull();
  });

  it('hides the whole card when everything is done', () => {
    state.aiOn = true;
    state.users = [
      { id: 1, kind: 'human', disabled: false },
      { id: 2, kind: 'human', disabled: false },
    ];
    state.tunnelState = 'running';
    const { container } = renderCard();
    expect(container.textContent).toBe('');
  });

  it('remembers dismissal in this browser', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Hide getting started' }));
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull();
    expect(localStorage.getItem(GETTING_STARTED_HIDDEN_KEY)).toBe('1');
    cleanup();
    renderCard();
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull();
  });

  it('still dismisses for this visit when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Hide getting started' }));
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull();
  });
});
