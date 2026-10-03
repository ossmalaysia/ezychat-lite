import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickRepliesPage } from './QuickRepliesPage';

vi.mock('../api/queries', () => ({
  useQuickReplies: () => ({
    data: [
      { id: 1, shortcut: 'delivery', body: 'Your parcel arrives tomorrow.', updatedAt: 0 },
      { id: 2, shortcut: 'refund', body: 'Returns are accepted within 14 days.', updatedAt: 0 },
    ],
    isPending: false,
    isError: false,
  }),
  useDeleteQuickReply: () => ({}),
  useSaveQuickReply: () => ({}),
}));
afterEach(cleanup);

it('finds replies by content or shortcut and clears an empty search', async () => {
  render(<QuickRepliesPage />);
  const user = userEvent.setup();
  const search = screen.getByRole('searchbox', { name: 'Search quick replies' });
  await user.type(search, 'PARCEL');
  expect(screen.getByText('/delivery')).toBeTruthy();
  expect(screen.queryByText('/refund')).toBeNull();
  await user.clear(search);
  await user.type(search, 'refund');
  expect(screen.getByText('/refund')).toBeTruthy();
  await user.clear(search);
  await user.type(search, 'nothing-matches');
  expect(screen.getByText('No matching quick replies')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /^Clear search$/ }));
  expect(screen.getByRole('status').textContent).toBe('2 of 2 quick replies');
});
