import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResolveAllChatsCard } from './ResolveAllChatsCard';

const mocks = vi.hoisted(() => ({
  count: {
    data: { openCount: 12 },
    isPending: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  resolve: { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as Error | null },
  success: vi.fn(),
}));
vi.mock('../api/queries', () => ({
  useOpenChatCount: () => mocks.count,
  useResolveAllChats: () => mocks.resolve,
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success } }));
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.count, {
    data: { openCount: 12 },
    isPending: false,
    isError: false,
    error: null,
  });
  Object.assign(mocks.resolve, { isPending: false, error: null });
});
afterEach(cleanup);

it('confirms the team-wide scope, allows cancellation, and submits only after confirmation', async () => {
  render(<ResolveAllChatsCard />);
  const user = userEvent.setup();
  expect(screen.getByRole('status').textContent).toBe('12 open chats');
  await user.click(screen.getByRole('button', { name: 'Resolve all open chats' }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog.textContent).toContain('across the whole team (12 right now)');
  expect(dialog.textContent).toContain('Assignees will be cleared');
  expect(mocks.resolve.mutate).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Resolve all open chats' }));
  await user.click(screen.getByRole('button', { name: /^Resolve all$/ }));
  expect(mocks.resolve.mutate).toHaveBeenCalledTimes(1);
  expect(mocks.resolve.mutate).toHaveBeenCalledWith(
    undefined,
    expect.objectContaining({ onSuccess: expect.any(Function) }),
  );
});

it('disables the trigger for empty, loading or failed counts and supports retry', async () => {
  mocks.count.data.openCount = 0;
  const view = render(<ResolveAllChatsCard />);
  const button = () => screen.getByRole('button', { name: 'Resolve all open chats' });
  expect(button().hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('status').textContent).toBe('No open chats to resolve.');
  mocks.count.isPending = true;
  view.rerender(<ResolveAllChatsCard />);
  expect(button().hasAttribute('disabled')).toBe(true);
  Object.assign(mocks.count, { isPending: false, isError: true, error: new Error('Offline') });
  view.rerender(<ResolveAllChatsCard />);
  expect(button().hasAttribute('disabled')).toBe(true);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  expect(mocks.count.refetch).toHaveBeenCalledOnce();
});

it('keeps the dialog open on error, blocks duplicate submissions while pending and reports the actual count', async () => {
  const view = render(<ResolveAllChatsCard />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Resolve all open chats' }));
  mocks.resolve.isPending = true;
  view.rerender(<ResolveAllChatsCard />);
  expect(
    screen.getByRole('button', { name: /^Resolve all$/ }).hasAttribute('disabled'),
  ).toBe(true);
  expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  Object.assign(mocks.resolve, { isPending: false, error: new Error('Cannot reach the server') });
  view.rerender(<ResolveAllChatsCard />);
  expect(screen.getByRole('alertdialog').textContent).toContain('Cannot reach the server');
  mocks.resolve.mutate.mockImplementation((_input, options) =>
    options.onSuccess({ resolvedCount: 9 }),
  );
  await user.click(screen.getByRole('button', { name: /^Resolve all$/ }));
  expect(mocks.success).toHaveBeenCalledWith('Resolved 9 chats.');
  expect(screen.queryByRole('alertdialog')).toBeNull();
});
