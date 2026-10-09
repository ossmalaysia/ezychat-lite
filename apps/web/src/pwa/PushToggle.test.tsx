import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PushToggle } from './PushToggle';

beforeEach(() => {
  localStorage.clear();
  window.watiNotifications = {
    isSupported: vi.fn().mockResolvedValue(true),
    show: vi.fn().mockResolvedValue(true),
    clear: vi.fn().mockResolvedValue(undefined),
  };
});
afterEach(() => {
  cleanup();
  delete window.watiNotifications;
});

it('turns desktop notifications on and off without browser push registration', async () => {
  render(<PushToggle />);
  const toggle = screen.getByRole('switch', { name: 'Notifications on this device' });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  expect(screen.queryByText(/registration failed/i)).toBeNull();
  expect(screen.getByText(/Keep it running in the tray/)).toBeTruthy();
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  expect(window.watiNotifications!.clear).toHaveBeenCalled();
});

it('shows a useful native availability error and keeps the switch off', async () => {
  vi.mocked(window.watiNotifications!.isSupported).mockResolvedValue(false);
  render(<PushToggle />);
  const toggle = screen.getByRole('switch', { name: 'Notifications on this device' });
  fireEvent.click(toggle);
  await screen.findByText(/Desktop notifications are unavailable/);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
});

it('keeps the compact label readable and its full device-specific accessible name', async () => {
  render(<PushToggle compact />);
  const toggle = screen.getByRole('switch', { name: 'Notifications on this device' });
  const label = toggle.parentElement!.querySelector('label')!;
  expect(label.textContent).toBe('Notifications');
  fireEvent.click(label);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  fireEvent.click(label);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
});

it('hands a settings row just the switch, with the desktop hint as a separate note', async () => {
  render(
    <div>
      <h3 id="row-label">Notifications</h3>
      <PushToggle labelledBy="row-label">
        {({ control, notes }) => (
          <>
            <div data-testid="control">{control}</div>
            <div data-testid="notes">{notes}</div>
          </>
        )}
      </PushToggle>
    </div>,
  );
  const control = screen.getByTestId('control');
  // The control slot holds only the switch, named by the row; no icon, label or long text.
  expect(control.textContent).toBe('');
  const toggle = screen.getByRole('switch', { name: 'Notifications' });
  expect(control.contains(toggle)).toBe(true);
  expect(screen.getByTestId('notes').textContent).toMatch(/allow EzyChat Lite in your system/);
  expect(screen.queryByText(/WA EzyChat/)).toBeNull();
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
});
