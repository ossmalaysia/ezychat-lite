import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DesktopUpdatesBridge, DesktopUpdateState } from '@wa-team-inbox/shared';
import { DesktopUpdateNotice, DesktopUpdatePanel } from './DesktopUpdates';

const auth = vi.hoisted(() => ({ user: { id: 1 } as { id: number } | null }));
const notify = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('sonner', () => ({ toast: notify }));
vi.mock('@/lib/use-media-query', () => ({ useMediaQuery: () => true }));

const available: DesktopUpdateState = {
  isHost: true,
  status: 'available',
  currentVersion: '0.1.12',
  checkedAt: '2026-10-03T12:00:00Z',
  error: null,
  release: {
    version: '0.1.13',
    name: 'Version 0.1.13',
    notes: '<script>untrusted release text</script>',
    publishedAt: '2026-10-03T11:00:00Z',
    prerelease: true,
    releaseUrl: 'https://github.com/ossmalaysia/wa-team-inbox/releases/tag/v0.1.13',
    downloadUrl:
      'https://github.com/ossmalaysia/wa-team-inbox/releases/download/v0.1.13/WA-Team-Inbox-0.1.13-win-x64.exe',
    assetName: 'WA-Team-Inbox-0.1.13-win-x64.exe',
  },
};
let listeners: Set<(state: DesktopUpdateState) => void>;
let bridge: DesktopUpdatesBridge;
beforeEach(() => {
  auth.user = { id: 1 };
  notify.mockClear();
  notify.dismiss.mockClear();
  listeners = new Set();
  bridge = {
    getState: vi.fn().mockResolvedValue(available),
    check: vi.fn().mockResolvedValue(available),
    openDownload: vi.fn().mockResolvedValue(undefined),
    openRelease: vi.fn().mockResolvedValue(undefined),
    onChanged: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
  window.watiUpdates = bridge;
});
afterEach(() => {
  cleanup();
  delete window.watiUpdates;
});
const emit = (state: DesktopUpdateState) =>
  act(() => {
    for (const listener of listeners) listener(state);
  });

it('phone and browser clients have no update workflow or alert', async () => {
  delete window.watiUpdates;
  render(
    <>
      <DesktopUpdateNotice />
      <DesktopUpdatePanel />
    </>,
  );
  expect(screen.queryByRole('region', { name: 'App updates' })).toBeNull();
  expect(notify).not.toHaveBeenCalled();
  expect(bridge.getState).not.toHaveBeenCalled();
});

it('a client-only desktop never offers updates even if a release was cached', async () => {
  vi.mocked(bridge.getState).mockResolvedValue({ ...available, isHost: false });
  render(
    <>
      <DesktopUpdateNotice />
      <DesktopUpdatePanel />
    </>,
  );
  await waitFor(() => expect(bridge.getState).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('region', { name: 'App updates' })).toBeNull();
  expect(notify).not.toHaveBeenCalled();
});

it('suggests each newer version once and lets the host review before downloading', async () => {
  render(<DesktopUpdateNotice />);
  await waitFor(() => expect(notify).toHaveBeenCalledOnce());
  emit({ ...available });
  expect(notify).toHaveBeenCalledOnce();
  const options = notify.mock.calls[0]![1] as { action: { onClick: () => void } };
  act(() => options.action.onClick());
  await screen.findByRole('button', { name: 'Download 0.1.13' });
  expect(screen.getByText('Preview release')).toBeTruthy();
  expect(screen.getByText('<script>untrusted release text</script>')).toBeTruthy();
  expect(document.querySelector('script')).toBeNull();
  expect(bridge.openDownload).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Download 0.1.13' }));
  expect(bridge.openDownload).toHaveBeenCalledWith();
});

it('does not alert a signed-out host; displays the suggestion after sign-in', async () => {
  auth.user = null;
  const view = render(<DesktopUpdateNotice />);
  await waitFor(() => expect(bridge.getState).toHaveBeenCalled());
  expect(notify).not.toHaveBeenCalled();
  auth.user = { id: 1 };
  view.rerender(<DesktopUpdateNotice />);
  await waitFor(() => expect(notify).toHaveBeenCalledOnce());
});

it('shows a missing installer honestly and opens only the main-process-selected release', async () => {
  vi.mocked(bridge.getState).mockResolvedValue({
    ...available,
    release: { ...available.release!, downloadUrl: null, assetName: null },
  });
  render(<DesktopUpdatePanel />);
  await screen.findByText(/compatible installer is not available/);
  expect(screen.queryByRole('button', { name: 'Download 0.1.13' })).toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Release on GitHub' }));
  expect(bridge.openRelease).toHaveBeenCalledWith();
});

it('keeps known release details on a failed refresh without claiming up to date', async () => {
  render(<DesktopUpdatePanel />);
  await screen.findByText('Version 0.1.13');
  emit({ ...available, status: 'error', error: 'GitHub is unavailable. Try again later.' });
  expect(screen.getByText('GitHub is unavailable. Try again later.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Download 0.1.13' })).toBeTruthy();
  expect(screen.queryByText(/No newer published/)).toBeNull();
});

it('a live update wins over an older in-flight snapshot and cleans up listeners', async () => {
  let resolve!: (value: DesktopUpdateState) => void;
  vi.mocked(bridge.getState).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(<DesktopUpdatePanel />);
  emit(available);
  await act(async () => resolve({ ...available, status: 'idle', release: null }));
  expect(screen.getByText('Version 0.1.13')).toBeTruthy();
  view.unmount();
  expect(listeners.size).toBe(0);
});

it('disables duplicate checks while checking and reports a bridge failure', async () => {
  vi.mocked(bridge.getState).mockResolvedValue({ ...available, status: 'checking', release: null });
  render(<DesktopUpdatePanel />);
  const checking = await screen.findByRole('button', { name: 'Checking…' });
  expect((checking as HTMLButtonElement).disabled).toBe(true);
  emit({ ...available, status: 'current', release: null });
  vi.mocked(bridge.check).mockRejectedValue(new Error('IPC unavailable'));
  await userEvent.setup().click(screen.getByRole('button', { name: 'Check for updates' }));
  await screen.findByText(/Could not check for updates/);
});
