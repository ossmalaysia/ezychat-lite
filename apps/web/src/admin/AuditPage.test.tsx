import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuditEntry } from '@wa-team-inbox/shared';
import { AuditPage } from './AuditPage';

const entries: AuditEntry[] = [
  {
    id: 4,
    at: 1_700_000_400_000,
    userId: 1,
    action: 'ai.member_update',
    ip: null,
    meta: { handoffRulesChanged: true, via: 'mcp', tokenId: 7, reason: 'narrow rule 4' },
    apiToken: { name: 'Claude Desktop', prefix: 'ezc_pat_ab12' },
  },
  { id: 3, at: 1_700_000_300_000, userId: 1, action: 'auth.login', ip: '127.0.0.1', meta: {} },
  {
    id: 2,
    at: 1_700_000_200_000,
    userId: 1,
    action: 'user.update',
    ip: '127.0.0.1',
    meta: { targetId: 2, role: 'admin' },
  },
  {
    id: 1,
    at: 1_700_000_100_000,
    userId: null,
    action: 'auth.login_failed',
    ip: '127.0.0.1',
    meta: { username: 'bob', reason: 'invalid' },
  },
];

vi.mock('../api/queries', () => ({
  useAudit: () => ({
    isPending: false,
    isError: false,
    data: { pages: [{ entries }] },
    hasNextPage: false,
  }),
  useUsers: () => ({
    data: [
      { id: 1, displayName: 'Alice Admin' },
      { id: 2, displayName: 'Bob Agent' },
    ],
  }),
}));

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

const table = () => screen.getByRole('table');

it('shows readable details with member names', () => {
  render(<AuditPage />);
  expect(within(table()).getByText('Member: Bob Agent · Role: Admin')).toBeTruthy();
  expect(
    within(table()).getByText('Username: bob · Reason: Wrong username or password'),
  ).toBeTruthy();
});

it('shows an AI assistant change under its access token name, with the owner below', () => {
  render(<AuditPage />);
  const row = within(table()).getByText('Claude Desktop').closest('tr')!;
  expect(within(row).getByText('Owner: Alice Admin')).toBeTruthy();
  expect(row.textContent).not.toContain('mcp');
});

it('hides routine sign-ins on request but keeps failed sign-ins', async () => {
  render(<AuditPage />);
  const user = userEvent.setup();
  expect(within(table()).getAllByText('Signed in').length).toBe(1);
  await user.click(screen.getByRole('radio', { name: 'Hide sign-ins' }));
  expect(within(table()).queryByText('Signed in')).toBeNull();
  expect(within(table()).getByText('Sign-in failed')).toBeTruthy();
  expect(screen.getByText('1 sign-in hidden')).toBeTruthy();
});

it('leaves out the empty Details row on phone cards', () => {
  render(<AuditPage />);
  const cards = screen.getAllByRole('listitem');
  const signIn = cards.find((c) => within(c).queryByText('Signed in'))!;
  expect(within(signIn).queryByText('Details')).toBeNull();
  const update = cards.find((c) => within(c).queryByText('Member updated'))!;
  expect(within(update).getByText('Details')).toBeTruthy();
});
