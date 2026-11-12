import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HiddenChatsInfo, WaStatus } from '@ezychat/shared';
import { WhatsAppPage } from './WhatsAppPage';

const hooks = vi.hoisted(() => ({
  wa: {} as WaStatus,
  hidden: undefined as HiddenChatsInfo | undefined,
  hiddenArgs: [] as unknown[],
}));
vi.mock('../api/queries', () => ({
  PRIMARY_INBOX_ID: 1,
  useWaStatus: () => ({ data: hooks.wa, isPending: false, isError: false }),
  useWaAction: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
}));
vi.mock('../api/chat-hide', () => ({
  useHiddenChats: (...args: unknown[]) => {
    hooks.hiddenArgs = args;
    return { data: hooks.hidden };
  },
}));
vi.mock('../wa/PhoneLink', () => ({ PhoneLink: () => null }));

beforeEach(() => {
  hooks.wa = {
    state: 'open',
    qr: null,
    me: { jid: '60000000000@s.whatsapp.net', name: 'Shop' },
    lastError: null,
  } as WaStatus;
  hooks.hidden = undefined;
});
afterEach(cleanup);

const actionButtons = () =>
  within(screen.getByRole('list', { name: 'Actions' }))
    .getAllByRole('button')
    .map((b) => b.textContent);

it('lists one row per action with Log out last and no Take over while connected', () => {
  render(<WhatsAppPage />);
  expect(actionButtons()).toEqual(['Re-link', 'Log out']);
  expect(screen.getByText(/fresh pairing/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Take over' })).toBeNull();
});

it('offers Take over first when the session was opened elsewhere', () => {
  hooks.wa = { ...hooks.wa, state: 'replaced' };
  render(<WhatsAppPage />);
  expect(actionButtons()).toEqual(['Take over', 'Re-link', 'Log out']);
});

it('still confirms Log out before disconnecting', async () => {
  render(<WhatsAppPage />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Log out' }));
  expect(screen.getByRole('alertdialog', { name: 'Log out of WhatsApp?' })).toBeTruthy();
});

it('shows the linked number and name in a compact list', () => {
  render(<WhatsAppPage />);
  expect(screen.getByText('+60000000000')).toBeTruthy();
  expect(screen.getByText('Shop')).toBeTruthy();
  expect(screen.getByTestId('wa-state').textContent).toBe('Connected');
});

it('suggests EzyChat Enterprise for more numbers in the Connection card', () => {
  render(<WhatsAppPage />);
  const note = screen.getByTestId('upgrade-note');
  expect(note.textContent).toContain('Need more WhatsApp numbers?');
  expect(
    within(note).getByRole('link', { name: 'Upgrade to Enterprise' }).getAttribute('href'),
  ).toBe(
    'https://ezychat.ai/?utm_source=ezychat-lite&utm_medium=app&utm_campaign=upgrade#enterprise',
  );
});

it("says how many chats Log out hides (inbox 1's counts, read again per state)", async () => {
  hooks.hidden = { visible: 128, hidden: 0, number: null };
  render(<WhatsAppPage />);
  expect(hooks.hiddenArgs).toEqual([1, 'open', true]);
  expect(
    screen.getByText(
      "Remove this inbox from the phone's linked devices. Its chats are hidden until the same number links again.",
    ),
  ).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Log out' }));
  const dialog = screen.getByRole('alertdialog', { name: 'Log out of WhatsApp?' });
  expect(
    within(dialog).getByText(
      'The linked device is removed from the phone. The team inbox stops receiving and sending messages.',
    ),
  ).toBeTruthy();
  expect(
    within(dialog).getByText(
      'The 128 chats of this number are hidden. Link the same number again to show the chats that are still on the phone.',
    ),
  ).toBeTruthy();
});

it('says the chats are hidden without a count while the counts load, and nothing with no chat', async () => {
  render(<WhatsAppPage />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Re-link' }));
  expect(
    within(screen.getByRole('alertdialog')).getByText(
      'The chats of this number are hidden. Link the same number again to show the chats that are still on the phone.',
    ),
  ).toBeTruthy();
  cleanup();
  hooks.hidden = { visible: 0, hidden: 0, number: null };
  render(<WhatsAppPage />);
  await user.click(screen.getByRole('button', { name: 'Log out' }));
  expect(within(screen.getByRole('alertdialog')).queryByText(/are hidden/)).toBeNull();
});

it('shows the hidden chats of the old number while logged out', () => {
  hooks.wa = { ...hooks.wa, state: 'logged_out', me: null };
  hooks.hidden = { visible: 0, hidden: 1, number: '60123456789' };
  render(<WhatsAppPage />);
  expect(
    screen.getByText(
      'The 1 chat of +60123456789 is hidden. Link the same number again to show the chats that are still on the phone. Another number starts with an empty inbox.',
    ),
  ).toBeTruthy();
});
