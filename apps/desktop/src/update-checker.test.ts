import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubUpdateChecker, type GitHubUpdateCheckerOptions } from './update-checker.js';

const REPO = 'https://github.com/ossmalaysia/ezychat-lite';

function release(version: string, overrides: Record<string, unknown> = {}) {
  const tag = `v${version}`;
  return {
    tag_name: tag,
    name: `WA Team Inbox ${version}`,
    body: 'Changes in this release',
    html_url: `${REPO}/releases/tag/${tag}`,
    draft: false,
    prerelease: true,
    published_at: '2026-10-03T00:00:00Z',
    // Shape of the actual published 0.1.9 preview: one Windows and two Mac installers.
    assets: ['win-x64.exe', 'mac-x64.dmg', 'mac-arm64.dmg'].map((suffix) => ({
      name: `WA-Team-Inbox-${version}-${suffix}`,
      state: 'uploaded',
      browser_download_url: `${REPO}/releases/download/${tag}/WA-Team-Inbox-${version}-${suffix}`,
    })),
    ...overrides,
  };
}

function response(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), init);
}

function checker(
  fetcher: ReturnType<typeof vi.fn>,
  options: Partial<GitHubUpdateCheckerOptions> = {},
) {
  return new GitHubUpdateChecker({
    currentVersion: '0.1.8',
    platform: 'win32',
    arch: 'x64',
    isHost: () => true,
    fetch: fetcher as unknown as typeof fetch,
    ...options,
  });
}

afterEach(() => vi.useRealTimers());

describe('GitHubUpdateChecker', () => {
  it('preserves only valid GitHub-provided SHA-256 and bounded installer-size metadata', async () => {
    const item = release('0.1.15');
    const digest = 'A'.repeat(64);
    item.assets = item.assets.map((asset) => ({
      ...asset,
      size: 12345,
      digest: `sha256:${digest}`,
    }));
    const state = await checker(vi.fn().mockResolvedValue(response([item]))).check();
    expect(state.release).toMatchObject({ assetSize: 12345, assetSha256: digest.toLowerCase() });
  });

  it.each([
    { size: 0, digest: 'sha256:bad' },
    { size: 1.5, digest: `md5:${'a'.repeat(64)}` },
    { size: 1024 * 1024 * 1024 + 1, digest: null },
  ])(
    'keeps release availability without trusting unsafe installer metadata: %j',
    async (metadata) => {
      const item = release('0.1.15');
      item.assets = item.assets.map((asset) => ({ ...asset, ...metadata }));
      const state = await checker(vi.fn().mockResolvedValue(response([item]))).check();
      expect(state).toMatchObject({
        status: 'available',
        release: { assetSize: null, assetSha256: null },
      });
    },
  );

  it('checks the fixed public API without a token and selects the Windows preview installer', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([release('0.1.9')]));
    const check = checker(fetcher);
    const state = await check.check();
    expect(state).toMatchObject({
      isHost: true,
      status: 'available',
      currentVersion: '0.1.8',
      error: null,
      release: {
        version: '0.1.9',
        prerelease: true,
        assetName: 'WA-Team-Inbox-0.1.9-win-x64.exe',
        downloadUrl: `${REPO}/releases/download/v0.1.9/WA-Team-Inbox-0.1.9-win-x64.exe`,
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/ossmalaysia/ezychat-lite/releases?per_page=100&page=1',
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
        headers: expect.not.objectContaining({ Authorization: expect.anything() }),
      }),
    );
  });

  it.each(['x64', 'arm64'])('selects only the matching %s Mac installer', async (arch) => {
    const state = await checker(vi.fn().mockResolvedValue(response([release('0.1.9')])), {
      platform: 'darwin',
      arch,
    }).check();
    expect(state.release?.assetName).toBe(`WA-Team-Inbox-0.1.9-mac-${arch}.dmg`);
  });

  it.each([
    { platform: 'win32' as const, arch: 'x64', suffix: 'win-x64.exe' },
    { platform: 'darwin' as const, arch: 'x64', suffix: 'mac-x64.dmg' },
    { platform: 'darwin' as const, arch: 'arm64', suffix: 'mac-arm64.dmg' },
  ])('prefers the new EzyChat Lite installer for $platform/$arch', async (options) => {
    const item = release('0.1.13');
    const name = `EzyChat-Lite-0.1.13-${options.suffix}`;
    item.assets.push({
      name,
      state: 'uploaded',
      browser_download_url: `${REPO}/releases/download/v0.1.13/${name}`,
    });
    const state = await checker(vi.fn().mockResolvedValue(response([item])), options).check();
    expect(state.release).toMatchObject({
      assetName: name,
      downloadUrl: `${REPO}/releases/download/v0.1.13/${name}`,
    });
  });

  it('normalizes historical release URLs to the renamed repository', async () => {
    const oldRepo = 'https://github.com/ossmalaysia/wa-team-inbox';
    const item = release('0.1.9', { html_url: `${oldRepo}/releases/tag/v0.1.9` });
    item.assets = item.assets.map((asset) => ({
      ...asset,
      browser_download_url: asset.browser_download_url.replace(REPO, oldRepo),
    }));
    const state = await checker(vi.fn().mockResolvedValue(response([item]))).check();
    expect(state.release).toMatchObject({
      releaseUrl: `${REPO}/releases/tag/v0.1.9`,
      downloadUrl: `${REPO}/releases/download/v0.1.9/WA-Team-Inbox-0.1.9-win-x64.exe`,
    });
  });

  it('sorts numerically, ignoring publication order and draft/invalid/unpublished versions', async () => {
    const data = [
      release('0.1.9', { published_at: '2026-11-01T00:00:00Z' }),
      release('0.1.10'),
      release('9.0.0', { draft: true }),
      release('8.0.0', { published_at: null }),
      release('01.2.3'),
      release('0.1.11-beta.01'),
      release('oops'),
    ];
    const state = await checker(vi.fn().mockResolvedValue(response(data)), {
      currentVersion: '0.1.9',
    }).check();
    expect(state.release?.version).toBe('0.1.10');
  });

  it.each(['0.1.9', '0.1.10', '0.1.11'])(
    'never offers a downgrade from %s',
    async (currentVersion) => {
      const state = await checker(vi.fn().mockResolvedValue(response([release('0.1.9')])), {
        currentVersion,
      }).check();
      expect(state).toMatchObject({ status: 'current', release: null, error: null });
    },
  );

  it('stable installs ignore both marked previews and semantic prereleases', async () => {
    const data = [
      release('3.0.0'),
      release('4.0.0-beta.1'),
      release('2.0.0', { prerelease: false }),
      release('5.0.0-beta.1', { prerelease: false }),
    ];
    const state = await checker(vi.fn().mockResolvedValue(response(data)), {
      currentVersion: '1.0.0',
    }).check();
    expect(state.release?.version).toBe('2.0.0');
  });

  it('orders preview identifiers correctly and permits a preview installation to follow its channel', async () => {
    const data = ['beta.2', 'beta.11', 'alpha', 'beta', 'beta.9'].map((suffix) =>
      release(`1.0.0-${suffix}`),
    );
    const state = await checker(vi.fn().mockResolvedValue(response(data)), {
      currentVersion: '1.0.0-beta.2',
    }).check();
    expect(state.release?.version).toBe('1.0.0-beta.11');
  });

  it('treats final releases as newer than semantic previews and ignores build metadata for ordering', async () => {
    const state = await checker(
      vi
        .fn()
        .mockResolvedValue(
          response([release('1.0.0-beta.99'), release('1.0.0', { prerelease: false })]),
        ),
      { currentVersion: '1.0.0-beta.100' },
    ).check();
    expect(state.release?.version).toBe('1.0.0');
    const same = await checker(
      vi.fn().mockResolvedValue(response([release('1.0.0+other', { prerelease: false })])),
      { currentVersion: '1.0.0+installed' },
    ).check();
    expect(same.status).toBe('current');
  });

  it.each([
    'https://evil.example/releases/tag/v0.1.9',
    'https://github.com/other/wa-team-inbox/releases/tag/v0.1.9',
    `${REPO}/releases/tag/v0.1.10`,
    `https://user:pass@github.com/ossmalaysia/wa-team-inbox/releases/tag/v0.1.9`,
    `${REPO}/releases/tag/v0.1.9?redirect=evil`,
  ])('rejects unsafe or mismatched release URL %s', async (html_url) => {
    const state = await checker(
      vi.fn().mockResolvedValue(response([release('0.1.9', { html_url })])),
    ).check();
    expect(state.release).toBeNull();
  });

  it.each([
    { state: 'new' },
    { name: 'installer.exe' },
    { browser_download_url: 'https://evil.example/installer.exe' },
    { browser_download_url: `${REPO}/releases/download/v0.1.10/WA-Team-Inbox-0.1.9-win-x64.exe` },
  ])(
    'falls back honestly when an installer is unuploaded/mismatched/unsafe: %j',
    async (assetOverrides) => {
      const item = release('0.1.9');
      item.assets = [{ ...item.assets[0]!, ...assetOverrides }];
      const state = await checker(vi.fn().mockResolvedValue(response([item]))).check();
      expect(state).toMatchObject({
        status: 'available',
        release: { downloadUrl: null, assetName: null },
      });
    },
  );

  it.each([
    { platform: 'linux' as const, arch: 'x64' },
    { platform: 'win32' as const, arch: 'arm64' },
  ])('does not offer an incompatible installer for %j', async (options) => {
    const state = await checker(
      vi.fn().mockResolvedValue(response([release('0.1.9')])),
      options,
    ).check();
    expect(state.release).toMatchObject({ version: '0.1.9', assetName: null, downloadUrl: null });
  });

  it('does not fetch or expose updates to clients, including when host ownership changes', async () => {
    let isHost = false;
    const fetcher = vi.fn().mockResolvedValue(response([release('0.1.9')]));
    const check = checker(fetcher, { isHost: () => isHost });
    expect(await check.check()).toMatchObject({ isHost: false, status: 'idle', release: null });
    expect(fetcher).not.toHaveBeenCalled();
    isHost = true;
    await check.check();
    isHost = false;
    expect(check.getState()).toMatchObject({ isHost: false, status: 'idle', release: null });
  });

  it('coalesces simultaneous checks and caches results during the one minute cooldown', async () => {
    let resolve!: (response: Response) => void;
    let now = 1_000_000;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const check = checker(fetcher, { now: () => now });
    const first = check.check();
    expect(check.check()).toBe(first);
    resolve(response([release('0.1.9')]));
    await first;
    await check.check();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 60_000;
    const next = check.check();
    resolve(response([]));
    await next;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retains a known newer release on an offline error and caches the error', async () => {
    let now = 1_000_000;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response([release('0.1.9')]))
      .mockRejectedValue(new Error('offline'));
    const check = checker(fetcher, { now: () => now });
    await check.check();
    now += 60_000;
    const state = await check.check();
    expect(state).toMatchObject({ status: 'error', release: { version: '0.1.9' } });
    expect(state.error).toContain('internet connection');
    await check.check();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([403, 429])('honors GitHub rate-limit retry instructions on %i', async (status) => {
    let now = 1_000_000;
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        response(
          {},
          {
            status,
            headers: { 'retry-after': '120', 'x-ratelimit-reset': '1300' },
          },
        ),
      ),
    );
    const check = checker(fetcher, { now: () => now });
    expect(await check.check()).toMatchObject({
      status: 'error',
      release: null,
      error: expect.stringContaining('limiting'),
    });
    now += 120_000;
    await check.check();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 1_300_000;
    await check.check();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    () => response({}, { status: 500 }),
    () => new Response('not JSON'),
    () => response({ releases: [] }),
    () => new Response('[]', { headers: { 'content-length': String(3 * 1024 * 1024) } }),
    () => new Response(' '.repeat(2 * 1024 * 1024 + 1)),
  ])('reports invalid/failed/bounded responses honestly', async (makeResponse) => {
    const state = await checker(vi.fn().mockResolvedValue(makeResponse())).check();
    expect(state).toMatchObject({ status: 'error', release: null, error: expect.any(String) });
  });

  it('follows bounded pages and finds a newer release on the next page', async () => {
    const firstPage = Array.from({ length: 100 }, () => release('0.1.1'));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(firstPage))
      .mockResolvedValueOnce(response([release('0.1.10')]));
    const state = await checker(fetcher).check();
    expect(state.release?.version).toBe('0.1.10');
    expect(fetcher.mock.calls[1]?.[0]).toContain('page=2');
  });

  it('never claims up to date when its bounded pagination leaves unseen releases', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(response(Array.from({ length: 100 }, () => release('0.1.1')))),
      );
    const state = await checker(fetcher).check();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(state).toMatchObject({
      status: 'error',
      error: expect.stringContaining('release history'),
    });
  });

  it('times out and reports the failure without offering an update', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const check = checker(fetcher);
    const pending = check.check();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toMatchObject({
      status: 'error',
      error: expect.stringContaining('timed out'),
      release: null,
    });
  });

  it('stop aborts pending work and ignores stale results and change callbacks', async () => {
    let resolve!: (response: Response) => void;
    const changed = vi.fn();
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const check = checker(fetcher, { onChanged: changed });
    const pending = check.check();
    const signal = (fetcher.mock.calls[0]?.[1] as RequestInit).signal;
    check.stop();
    expect(signal?.aborted).toBe(true);
    resolve(response([release('0.1.9')]));
    expect(await pending).toMatchObject({ status: 'idle', release: null });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('starts once, checks every twelve hours, and stops its timer', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response([])));
    const check = checker(fetcher);
    check.start();
    check.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    check.stop();
    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns defensive copies rather than allowing callers to replace approved URLs', async () => {
    const check = checker(vi.fn().mockResolvedValue(response([release('0.1.9')])));
    const state = await check.check();
    state.release!.downloadUrl = 'https://evil.example';
    expect(check.getState().release?.downloadUrl).toContain('https://github.com/ossmalaysia/');
  });
});
