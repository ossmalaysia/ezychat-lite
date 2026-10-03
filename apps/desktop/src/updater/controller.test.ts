import { describe, expect, it, vi } from 'vitest';
import type { DesktopUpdateState } from '@wa-team-inbox/shared';
import { ManagedUpdates } from './controller.js';

function fixture() {
  const state: DesktopUpdateState = {
    isHost: true,
    status: 'available',
    currentVersion: '0.1.14',
    checkedAt: null,
    error: null,
    release: {
      version: '0.1.15',
      name: 'New release',
      notes: '',
      publishedAt: '2026-10-04T00:00:00Z',
      prerelease: false,
      releaseUrl: 'https://github.com/ossmalaysia/ezychat-lite/releases/tag/v0.1.15',
      downloadUrl:
        'https://github.com/ossmalaysia/ezychat-lite/releases/download/v0.1.15/EzyChat-Lite-0.1.15-win-x64.exe',
      assetName: 'EzyChat-Lite-0.1.15-win-x64.exe',
      assetSize: 42,
      assetSha256: 'a'.repeat(64),
    },
  };
  const artifact = {
    filePath: '/isolated/update.exe',
    sha256: 'a'.repeat(64),
    version: '0.1.15',
    assetName: state.release!.assetName!,
    size: 42,
  };
  const checker = {
    getState: () => state,
    check: vi.fn(async () => state),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const options = {
    checker,
    canInstall: vi.fn(() => true),
    unavailableReason: 'Install the app first.',
    download: vi.fn(async () => artifact),
    verify: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    onChanged: vi.fn(),
  };
  return { state, artifact, checker, options, updates: new ManagedUpdates(options) };
}

describe('managed desktop updates', () => {
  it('downloads to readiness without stopping or installing until the explicit install action', async () => {
    const { updates, options } = fixture();
    expect(() => updates.install()).toThrow('Download and verify');
    await updates.download();
    expect(updates.getState().transfer).toMatchObject({
      status: 'ready',
      version: '0.1.15',
      downloadedBytes: 42,
    });
    expect(options.install).not.toHaveBeenCalled();
    const first = updates.install();
    expect(updates.install()).toBe(first);
    await first;
    expect(options.verify).toHaveBeenCalledOnce();
    expect(options.install).toHaveBeenCalledOnce();
  });

  it('shares one download and keeps the selected release pinned if a background check changes', async () => {
    const { state, updates, options, artifact } = fixture();
    let finish!: (value: typeof artifact) => void;
    options.download.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = updates.download();
    expect(updates.download()).toBe(first);
    await Promise.resolve();
    state.release = { ...state.release!, version: '0.1.16' };
    finish(artifact);
    await first;
    expect(updates.getState().release?.version).toBe('0.1.15');
    expect(options.download).toHaveBeenCalledOnce();
  });

  it('refuses hostless/development installs and hides private host transfer state from clients', async () => {
    const { state, updates, options } = fixture();
    await updates.download();
    state.isHost = false;
    expect(() => updates.install()).toThrow('hosting computer');
    expect(updates.getState().transfer?.status).toBe('idle');
    state.isHost = true;
    options.canInstall.mockReturnValue(false);
    expect(() => updates.download()).toThrow('Install the app first');
    expect(options.install).not.toHaveBeenCalled();
  });

  it('cancels pending downloads without promoting a late completed artifact to ready', async () => {
    const { updates, options, artifact } = fixture();
    let finish!: (value: typeof artifact) => void;
    options.download.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = updates.download();
    await Promise.resolve();
    updates.cancelDownload();
    finish(artifact);
    await pending;
    expect(updates.getState().transfer?.status).toBe('idle');
    expect(() => updates.install()).toThrow('Download and verify');
  });

  it('does not hand off a modified artifact or a host whose ownership changed during verification', async () => {
    const { updates, state, options } = fixture();
    await updates.download();
    options.verify.mockRejectedValueOnce(new Error('Verification failed'));
    await updates.install();
    expect(updates.getState().transfer).toMatchObject({
      status: 'error',
      error: 'Verification failed',
    });
    expect(options.install).not.toHaveBeenCalled();
    await updates.download();
    options.verify.mockImplementationOnce(async () => {
      state.isHost = false;
    });
    await updates.install();
    expect(options.install).not.toHaveBeenCalled();
  });

  it('waits for cancellation cleanup before an immediate retry of the same download', async () => {
    const { updates, options, artifact } = fixture();
    let finish!: (value: typeof artifact) => void;
    options.download.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const cancelled = updates.download();
    await Promise.resolve();
    updates.cancelDownload();
    const retry = updates.download();
    expect(options.download).toHaveBeenCalledOnce();
    finish(artifact);
    await Promise.all([cancelled, retry]);
    expect(options.download).toHaveBeenCalledTimes(2);
    expect(updates.getState().transfer?.status).toBe('ready');
  });

  it('reports a failed/cancelled preparation while retaining the running application', async () => {
    const { updates, options } = fixture();
    await updates.download();
    options.install.mockRejectedValueOnce(new Error('Administrator approval was cancelled'));
    await updates.install();
    expect(updates.getState().transfer).toMatchObject({
      status: 'error',
      error: 'Administrator approval was cancelled',
    });
  });
});
