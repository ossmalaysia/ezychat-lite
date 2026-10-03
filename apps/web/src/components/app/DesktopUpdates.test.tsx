import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import type { DesktopUpdatesBridge, DesktopUpdateState } from '@wa-team-inbox/shared';
import { DesktopUpdateNotice, DesktopUpdatePanel } from './DesktopUpdates';

const auth = vi.hoisted(() => ({ user: { id: 1 } as { id: number } | null }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => auth }));
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
    releaseUrl: 'https://github.com/ossmalaysia/ezychat-lite/releases/tag/v0.1.13',
    downloadUrl:
      'https://github.com/ossmalaysia/ezychat-lite/releases/download/v0.1.13/EzyChat-Lite-0.1.13-win-x64.exe',
    assetName: 'EzyChat-Lite-0.1.13-win-x64.exe',
  },
};
let listeners: Set<(state: DesktopUpdateState) => void>;
let bridge: DesktopUpdatesBridge;
beforeEach(() => {
  auth.user = { id: 1 };
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
  expect(screen.queryByRole('button', { name: 'Review update' })).toBeNull();
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
  expect(screen.queryByRole('button', { name: 'Review update' })).toBeNull();
});

it('suggests each newer version once and lets the host review before downloading', async () => {
  render(<DesktopUpdateNotice />);
  await screen.findByRole('button', { name: 'Review update' });
  emit({ ...available });
  expect(screen.getAllByRole('button', { name: 'Review update' })).toHaveLength(1);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Review update' }));
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
  expect(screen.queryByRole('button', { name: 'Review update' })).toBeNull();
  auth.user = { id: 1 };
  view.rerender(<DesktopUpdateNotice />);
  await screen.findByRole('button', { name: 'Review update' });
});

it('keeps the update prompt stable in StrictMode and respects dismissal until a new version', async () => {
  render(
    <StrictMode>
      <DesktopUpdateNotice />
    </StrictMode>,
  );
  await screen.findByRole('button', { name: 'Review update' });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss update suggestion' }));
  emit({ ...available });
  expect(screen.queryByRole('button', { name: 'Review update' })).toBeNull();
  emit({ ...available, release: { ...available.release!, version: '0.1.14' } });
  await screen.findByRole('button', { name: 'Review update' });
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

it('shows download progress, allows cancellation, and never installs automatically', async () => {
  bridge.installUpdate = vi.fn().mockResolvedValue(undefined);
  bridge.cancelDownload = vi.fn().mockResolvedValue(undefined);
  vi.mocked(bridge.getState).mockResolvedValue({
    ...available,
    canInstall: true,
    release: { ...available.release!, assetSize: 100, assetSha256: 'a'.repeat(64) },
    transfer: {
      status: 'downloading',
      version: '0.1.13',
      downloadedBytes: 45,
      totalBytes: 100,
      error: null,
    },
  });
  render(<DesktopUpdatePanel />);
  expect(
    (await screen.findByRole('progressbar', { name: 'Update download' })).getAttribute(
      'aria-valuenow',
    ),
  ).toBe('45');
  expect(
    (screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel download' }));
  expect(bridge.cancelDownload).toHaveBeenCalledOnce();
  expect(bridge.installUpdate).not.toHaveBeenCalled();
});

it('prompts when verified bytes are ready and installs only after Restart and update', async () => {
  bridge.installUpdate = vi.fn().mockResolvedValue(undefined);
  render(<DesktopUpdateNotice />);
  await screen.findByRole('button', { name: 'Review update' });
  const ready: DesktopUpdateState = {
    ...available,
    canInstall: true,
    release: { ...available.release!, assetSize: 100, assetSha256: 'a'.repeat(64) },
    transfer: {
      status: 'ready',
      version: '0.1.13',
      downloadedBytes: 100,
      totalBytes: 100,
      error: null,
    },
  };
  vi.mocked(bridge.getState).mockResolvedValue(ready);
  emit(ready);
  const button = await screen.findByRole('button', { name: 'Restart and update' });
  expect(bridge.installUpdate).not.toHaveBeenCalled();
  await userEvent.setup().click(button);
  expect(bridge.installUpdate).toHaveBeenCalledOnce();
  emit({ ...ready, transfer: { ...ready.transfer!, status: 'installing' } });
  expect(screen.queryByRole('button', { name: 'Restart and update' })).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Download 0.1.13' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('requires trusted installer metadata and reports failed update recovery', async () => {
  bridge.installUpdate = vi.fn().mockResolvedValue(undefined);
  vi.mocked(bridge.getState).mockResolvedValue({
    ...available,
    canInstall: true,
    lastInstall: {
      status: 'error',
      version: '0.1.13',
      message: 'Update failed. The previous app was restored.',
    },
  });
  render(<DesktopUpdatePanel />);
  expect(
    ((await screen.findByRole('button', { name: 'Download 0.1.13' })) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText(/cannot be verified/)).toBeTruthy();
  expect(screen.getByText('Update failed. The previous app was restored.')).toBeTruthy();
});
