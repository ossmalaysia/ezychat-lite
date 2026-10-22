import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Inbox, User } from '@ezychat/shared';
import { InboxAccessCell } from './InboxAccess';

const base: User = {
  id: 2,
  username: 'bob',
  displayName: 'Bob Agent',
  role: 'agent',
  mustChangePassword: false,
  disabled: false,
  createdAt: 1_700_000_000_000,
  locale: null,
};
const status = { state: 'open' as const, qr: null, me: null, lastError: null };
const SALES: Inbox = {
  id: 1,
  name: 'Sales',
  tone: 'primary',
  number: null,
  status,
  removed: false,
  aiAgentId: null,
};

function show(user: User, inboxes: Inbox[] = [SALES]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InboxAccessCell user={user} inboxes={inboxes} />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
});
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InboxAccessCell', () => {
  it('says nothing to set for the AI member, which answers every inbox', () => {
    show({ ...base, kind: 'ai' });
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows admins as seeing every inbox, with nothing to tick', () => {
    show({ ...base, role: 'admin' });
    expect(screen.getByText('All inboxes (admin)')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('tells the admin to add an inbox first when there is none to tick', async () => {
    show(base, []);
    expect(screen.getByText('No inbox: this agent sees no chats')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Inboxes for Bob Agent' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('No inbox yet. Add one under Inboxes.')).toBeTruthy();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
  });
});
