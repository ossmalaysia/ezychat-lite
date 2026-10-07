import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WaStatus } from '@wa-team-inbox/shared';
import { WhatsAppPage } from './WhatsAppPage';

const hooks = vi.hoisted(() => ({ wa: {} as WaStatus }));
vi.mock('../api/queries', () => ({
  useWaStatus: () => ({ data: hooks.wa, isPending: false, isError: false }),
  useWaAction: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
}));
vi.mock('../wa/PhoneLink', () => ({ PhoneLink: () => null }));

beforeEach(() => {
  hooks.wa = {
    state: 'open',
    qr: null,
    me: { jid: '60000000000@s.whatsapp.net', name: 'Shop' },
    lastError: null,
  } as WaStatus;
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
