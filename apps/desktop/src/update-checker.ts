import type {
  DesktopRelease,
  DesktopUpdateState,
} from '../../../packages/shared/src/desktop-updates.js';
import { MAX_UPDATE_BYTES } from './updater/download.js';

const REPOSITORY = 'ossmalaysia/ezychat-lite';
// Historical releases can retain their original URLs after GitHub renames the repository.
const RELEASE_REPOSITORIES = [REPOSITORY, 'ossmalaysia/wa-team-inbox'];
const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases`;
const INTERVAL_MS = 12 * 60 * 60 * 1000;
const COOLDOWN_MS = 60_000;
const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 3;

interface Version {
  core: bigint[];
  prerelease: string[];
}

function parseVersion(value: string): Version | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/.exec(
      value,
    );
  if (!match) return null;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    return null;
  }
  return { core: match.slice(1, 4).map((part) => BigInt(part!)), prerelease };
}

function compareVersions(a: Version, b: Version): number {
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index]! > b.core[index]! ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0;
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return BigInt(left) > BigInt(right) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function installerNames(version: string, platform: NodeJS.Platform, arch: string): string[] {
  let suffix: string;
  if (platform === 'win32' && arch === 'x64') suffix = 'win-x64.exe';
  else if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64'))
    suffix = `mac-${arch}.dmg`;
  else return [];
  return ['EzyChat-Lite', 'WA-Team-Inbox'].map((name) => `${name}-${version}-${suffix}`);
}

function parseRelease(
  value: unknown,
  allowPreview: boolean,
  platform: NodeJS.Platform,
  arch: string,
): { version: Version; release: DesktopRelease } | null {
  const item = record(value);
  if (!item || item.draft !== false || typeof item.prerelease !== 'boolean') return null;
  if (typeof item.tag_name !== 'string' || item.tag_name.length > 200) return null;
  const versionString = item.tag_name.startsWith('v') ? item.tag_name.slice(1) : item.tag_name;
  const version = parseVersion(versionString);
  if (!version || (!allowPreview && (item.prerelease || version.prerelease.length))) return null;
  // A semantic preview must also be explicitly published as a GitHub prerelease.
  if (version.prerelease.length && !item.prerelease) return null;
  if (typeof item.published_at !== 'string' || !Number.isFinite(Date.parse(item.published_at))) {
    return null;
  }
  const releaseUrl = `https://github.com/${REPOSITORY}/releases/tag/${item.tag_name}`;
  if (
    !RELEASE_REPOSITORIES.some(
      (repo) => item.html_url === `https://github.com/${repo}/releases/tag/${item.tag_name}`,
    )
  )
    return null;
  let installer: Record<string, unknown> | null = null;
  for (const name of installerNames(versionString, platform, arch)) {
    installer = Array.isArray(item.assets)
      ? (item.assets
          .map(record)
          .find(
            (details) =>
              details?.name === name &&
              details.state === 'uploaded' &&
              RELEASE_REPOSITORIES.some(
                (repo) =>
                  details.browser_download_url ===
                  `https://github.com/${repo}/releases/download/${item.tag_name}/${name}`,
              ),
          ) ?? null)
      : null;
    if (installer) break;
  }
  const expectedAsset = installer?.name as string | undefined;
  const downloadUrl = expectedAsset
    ? `https://github.com/${REPOSITORY}/releases/download/${item.tag_name}/${expectedAsset}`
    : null;
  return {
    version,
    release: {
      version: versionString,
      name: typeof item.name === 'string' ? item.name.slice(0, 500) : `v${versionString}`,
      notes: typeof item.body === 'string' ? item.body.slice(0, 20_000) : '',
      publishedAt: new Date(item.published_at).toISOString(),
      prerelease: item.prerelease,
      releaseUrl,
      downloadUrl,
      assetName: expectedAsset ?? null,
      assetSize:
        typeof installer?.size === 'number' &&
        Number.isSafeInteger(installer.size) &&
        installer.size > 0 &&
        installer.size <= MAX_UPDATE_BYTES
          ? installer.size
          : null,
      assetSha256:
        typeof installer?.digest === 'string' && /^sha256:[a-fA-F0-9]{64}$/.test(installer.digest)
          ? installer.digest.slice('sha256:'.length).toLowerCase()
          : null,
    },
  };
}

class CheckError extends Error {
  constructor(
    message: string,
    readonly kind: string,
    readonly retryAt?: number,
  ) {
    super(message);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new CheckError('GitHub returned too much update information. Try again later.', 'size');
  }
  if (!response.body) throw new CheckError('GitHub returned no update information.', 'response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let json = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new CheckError(
          'GitHub returned too much update information. Try again later.',
          'size',
        );
      }
      json += decoder.decode(chunk.value, { stream: true });
    }
    json += decoder.decode();
    return JSON.parse(json) as unknown;
  } catch (error) {
    if (error instanceof CheckError) throw error;
    if (error instanceof SyntaxError) {
      throw new CheckError(
        'GitHub returned invalid update information. Try again later.',
        'response',
      );
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export interface GitHubUpdateCheckerOptions {
  currentVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  isHost: () => boolean;
  onChanged?: (state: DesktopUpdateState) => void;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  log?: (fields: Record<string, unknown>) => void;
}

/** Checks public release metadata only; downloading/installing is an explicit host action. */
export class GitHubUpdateChecker {
  private state: DesktopUpdateState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: Promise<DesktopUpdateState> | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private nextCheckAt = 0;
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => number;

  constructor(private readonly options: GitHubUpdateCheckerOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.state = {
      isHost: options.isHost(),
      status: 'idle',
      currentVersion: options.currentVersion,
      checkedAt: null,
      release: null,
      error: null,
    };
  }

  getState(): DesktopUpdateState {
    const isHost = this.options.isHost();
    return {
      ...this.state,
      isHost,
      release: isHost && this.state.release ? { ...this.state.release } : null,
      status: isHost ? this.state.status : 'idle',
      error: isHost ? this.state.error : null,
    };
  }

  start(): void {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.pending = null;
    this.nextCheckAt = 0;
    if (this.state.status === 'checking') {
      this.state = { ...this.state, status: this.state.release ? 'available' : 'idle' };
    }
  }

  check(): Promise<DesktopUpdateState> {
    if (!this.options.isHost()) return Promise.resolve(this.getState());
    if (this.pending) return this.pending;
    if (this.now() < this.nextCheckAt) return Promise.resolve(this.getState());
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.nextCheckAt = this.now() + COOLDOWN_MS;
    this.publish({ ...this.state, isHost: true, status: 'checking', error: null });
    const pending = this.performCheck(generation, controller).finally(() => {
      if (this.pending === pending) {
        this.pending = null;
        this.controller = null;
      }
    });
    this.pending = pending;
    return pending;
  }

  private publish(state: DesktopUpdateState): void {
    this.state = state;
    this.options.onChanged?.(this.getState());
  }

  private async performCheck(
    generation: number,
    controller: AbortController,
  ): Promise<DesktopUpdateState> {
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    timeout.unref();
    const startedAt = this.now();
    let pages = 0;
    try {
      const current = parseVersion(this.options.currentVersion);
      if (!current)
        throw new CheckError(
          'This build has an invalid version. Check the project releases.',
          'version',
        );
      const allowPreview = current.core[0] === 0n || current.prerelease.length > 0;
      let newest: { version: Version; release: DesktopRelease } | null = null;
      let complete = false;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await this.fetch(`${RELEASES_API}?per_page=100&page=${page}`, {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'EzyChat-Lite-Update-Checker',
          },
          signal: controller.signal,
          redirect: 'error',
        });
        pages++;
        if (generation !== this.generation || !this.options.isHost()) return this.getState();
        if (controller.signal.aborted) {
          throw new CheckError('The update check timed out. Please try again later.', 'timeout');
        }
        if (response.status === 403 || response.status === 429) {
          const retrySeconds = Number(response.headers.get('retry-after'));
          const resetSeconds = Number(response.headers.get('x-ratelimit-reset'));
          const requestedRetry = Math.max(
            this.now() + (Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 0),
            Number.isFinite(resetSeconds) ? resetSeconds * 1000 : 0,
            this.now() + COOLDOWN_MS,
          );
          const retryAt = Math.min(requestedRetry, this.now() + 24 * 60 * 60 * 1000);
          throw new CheckError(
            'GitHub is limiting update checks. Please try again later.',
            'rate_limit',
            retryAt,
          );
        }
        if (!response.ok)
          throw new CheckError(
            'GitHub could not check for updates. Please try again later.',
            'http',
          );
        const json = await readJson(response);
        if (generation !== this.generation || !this.options.isHost()) return this.getState();
        if (controller.signal.aborted) {
          throw new CheckError('The update check timed out. Please try again later.', 'timeout');
        }
        if (!Array.isArray(json) || json.length > 100) {
          throw new CheckError(
            'GitHub returned invalid update information. Try again later.',
            'response',
          );
        }
        for (const item of json) {
          const candidate = parseRelease(
            item,
            allowPreview,
            this.options.platform,
            this.options.arch,
          );
          if (candidate && (!newest || compareVersions(candidate.version, newest.version) > 0)) {
            newest = candidate;
          }
        }
        if (json.length < 100) {
          complete = true;
          break;
        }
      }
      const release =
        newest && compareVersions(newest.version, current) > 0 ? newest.release : null;
      if (!complete && !release) {
        throw new CheckError(
          'The release history is too large to confirm the latest version. Check the project releases.',
          'pagination',
        );
      }
      if (generation !== this.generation || !this.options.isHost()) {
        return this.getState();
      }
      this.publish({
        ...this.state,
        status: release ? 'available' : 'current',
        release,
        checkedAt: new Date(this.now()).toISOString(),
        error: null,
      });
      this.options.log?.({
        mod: 'updates',
        event: 'checked',
        status: this.state.status,
        pages,
        durationMs: this.now() - startedAt,
        version: release?.version ?? this.options.currentVersion,
      });
    } catch (error) {
      if (generation !== this.generation || !this.options.isHost()) return this.getState();
      const failure =
        error instanceof CheckError
          ? error
          : new CheckError(
              controller.signal.aborted
                ? 'The update check timed out. Please try again later.'
                : 'Could not reach GitHub. Check your internet connection and try again.',
              controller.signal.aborted ? 'timeout' : 'network',
            );
      if (failure.retryAt) this.nextCheckAt = Math.max(this.nextCheckAt, failure.retryAt);
      this.publish({
        ...this.state,
        status: 'error',
        error: failure.message,
        checkedAt: new Date(this.now()).toISOString(),
      });
      this.options.log?.({
        mod: 'updates',
        event: 'check_failed',
        kind: failure.kind,
        pages,
        durationMs: this.now() - startedAt,
      });
    } finally {
      clearTimeout(timeout);
    }
    return this.getState();
  }
}
