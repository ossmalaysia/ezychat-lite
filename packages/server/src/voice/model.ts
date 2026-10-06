import { createHash } from 'node:crypto';
import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { mkdir, open, rename, rm, statfs, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { VoiceModelError, VoiceModelStatus } from '@wa-team-inbox/shared';

/** One pinned model file of the GitHub release `models-whisper-small-v1`. */
export interface VoiceModelFile {
  name: string;
  size: number;
  sha256: string;
}

export const VOICE_MODEL_REPOSITORY = 'ossmalaysia/ezychat-lite';
export const VOICE_MODEL_TAG = 'models-whisper-small-v1';
/** OpenAI Whisper small, int8 ONNX export for sherpa-onnx (encoder, decoder, tokens). */
export const VOICE_MODEL_FILES: readonly VoiceModelFile[] = [
  {
    name: 'small-encoder.int8.onnx',
    size: 112_442_483,
    sha256: '4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9',
  },
  {
    name: 'small-decoder.int8.onnx',
    size: 262_226_114,
    sha256: 'acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee',
  },
  {
    name: 'small-tokens.txt',
    size: 816_730,
    sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
  },
];
/** Free space required before a download starts (model plus room for partial files and the DB). */
export const VOICE_MODEL_MIN_FREE_BYTES = 800 * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
/** GitHub's release asset CDN hosts (the only redirect targets accepted). */
const ASSET_HOSTS = ['objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

export class VoiceModelDownloadError extends Error {
  constructor(
    readonly code: VoiceModelError,
    message: string,
  ) {
    super(message);
    this.name = 'VoiceModelDownloadError';
  }
}

export function voiceModelUrl(name: string): string {
  return `https://github.com/${VOICE_MODEL_REPOSITORY}/releases/download/${VOICE_MODEL_TAG}/${name}`;
}

/** Only the pinned GitHub release URL of `name` and GitHub's release-asset CDN are fetched. */
export function voiceModelUrlAllowed(value: string, name: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash)
      return false;
    if (url.hostname === 'github.com') return !url.search && url.href === voiceModelUrl(name);
    return (
      ASSET_HOSTS.includes(url.hostname) &&
      /^\/github-production-release-asset(?:-[a-zA-Z0-9]+)?\//.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason as Error);
    signal.addEventListener('abort', aborted, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

async function freeBytesOf(dir: string): Promise<number> {
  const s = await statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
}

/** The file's SHA-256 (hex), or false when it is missing or has another size. */
async function sha256File(
  path: string,
  size: number,
  signal: AbortSignal,
): Promise<string | false> {
  let file: FileHandle | null = null;
  try {
    file = await open(path, 'r');
    if ((await file.stat()).size !== size) return false;
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest('hex');
  } catch (error) {
    if (signal.aborted) throw error;
    return false;
  } finally {
    await file?.close().catch(() => undefined);
  }
}

export interface VoiceModelManagerOptions {
  /** `<data>/models/whisper-small` */
  dir: string;
  log?: Logger;
  /** Called on every state change and (throttled) on progress. */
  onChange?: (status: VoiceModelStatus) => void;
  fetch?: typeof globalThis.fetch;
  freeBytes?: (dir: string) => Promise<number>;
  /** Tests use small files with the same pinned URL layout. */
  files?: readonly VoiceModelFile[];
  /** No data for this long → the download fails as a network error. */
  stallMs?: number;
  progressIntervalMs?: number;
}

/**
 * Downloads, verifies and removes the local Whisper model. One download at a time; every file is
 * streamed to `<name>.partial` while hashing, and renamed into place only after its exact size
 * and SHA-256 match the pinned values.
 */
export class VoiceModelManager {
  readonly files: readonly VoiceModelFile[];
  readonly totalBytes: number;
  private state: VoiceModelStatus;
  private controller: AbortController | null = null;
  private job: Promise<void> | null = null;
  private lastProgress = 0;

  constructor(private readonly options: VoiceModelManagerOptions) {
    this.files = options.files ?? VOICE_MODEL_FILES;
    this.totalBytes = this.files.reduce((sum, file) => sum + file.size, 0);
    this.state = this.idleState(null);
  }

  status(): VoiceModelStatus {
    return { ...this.state };
  }

  /** Model file paths when installed (all files present with their exact sizes). */
  paths(): { encoder: string; decoder: string; tokens: string } | null {
    if (this.state.state !== 'installed') return null;
    const path = (suffix: string) =>
      join(this.options.dir, this.files.find((file) => file.name.endsWith(suffix))!.name);
    return {
      encoder: path('encoder.int8.onnx'),
      decoder: path('decoder.int8.onnx'),
      tokens: path('tokens.txt'),
    };
  }

  /** Startup: drop stale partial files and check sizes (hashes were checked at install time). */
  init(): VoiceModelStatus {
    try {
      if (existsSync(this.options.dir))
        for (const name of readdirSync(this.options.dir))
          if (name.endsWith('.partial')) unlinkSync(join(this.options.dir, name));
    } catch (error) {
      this.options.log?.warn({ err: error }, 'voice model partial cleanup failed');
    }
    this.set(this.idleState(null));
    return this.status();
  }

  /** Starts a download (no-op while one runs or when installed). Resolves when it has started. */
  start(): VoiceModelStatus {
    if (this.job || this.installed()) return this.status();
    const controller = new AbortController();
    this.controller = controller;
    this.lastProgress = 0;
    this.set({ state: 'downloading', receivedBytes: 0, totalBytes: this.totalBytes, error: null });
    this.job = this.run(controller.signal)
      .then(() => {
        this.set(this.idleState(null));
        this.options.log?.info({ event: 'voice_model_installed' }, 'Voice model installed');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          this.set(this.idleState(null));
          this.options.log?.info(
            { event: 'voice_model_cancelled' },
            'Voice model download cancelled',
          );
          return;
        }
        const code = error instanceof VoiceModelDownloadError ? error.code : 'unknown';
        this.options.log?.warn(
          { event: 'voice_model_failed', code, err: error instanceof Error ? error.message : '' },
          'Voice model download failed',
        );
        this.set({ ...this.idleState(code), state: 'error' });
      })
      .finally(() => {
        this.job = null;
        this.controller = null;
      });
    return this.status();
  }

  /** The running download (tests and shutdown). */
  whenIdle(): Promise<void> {
    return this.job ?? Promise.resolve();
  }

  async cancel(): Promise<VoiceModelStatus> {
    this.controller?.abort(new Error('cancelled'));
    await this.whenIdle();
    return this.status();
  }

  async remove(): Promise<VoiceModelStatus> {
    await this.cancel();
    await rm(this.options.dir, { recursive: true, force: true });
    this.set(this.idleState(null));
    return this.status();
  }

  private installed(): boolean {
    return this.files.every((file) => {
      try {
        const s = statSync(join(this.options.dir, file.name));
        return s.isFile() && s.size === file.size;
      } catch {
        return false;
      }
    });
  }

  private idleState(error: VoiceModelError | null): VoiceModelStatus {
    return {
      state: error ? 'error' : this.installed() ? 'installed' : 'not_installed',
      receivedBytes: 0,
      totalBytes: this.totalBytes,
      error,
    };
  }

  private set(next: VoiceModelStatus) {
    this.state = next;
    this.options.onChange?.(this.status());
  }

  private progress(receivedBytes: number) {
    const now = Date.now();
    if (now - this.lastProgress < (this.options.progressIntervalMs ?? 250)) return;
    this.lastProgress = now;
    this.set({ ...this.state, receivedBytes });
  }

  private async run(signal: AbortSignal) {
    const dir = this.options.dir;
    try {
      await mkdir(dir, { recursive: true });
    } catch {
      throw new VoiceModelDownloadError('write', 'Cannot create the model folder');
    }
    const free = await (this.options.freeBytes ?? freeBytesOf)(dir).catch(() => {
      throw new VoiceModelDownloadError('disk_space', 'Cannot check free disk space');
    });
    if (free < VOICE_MODEL_MIN_FREE_BYTES)
      throw new VoiceModelDownloadError('disk_space', 'Not enough free disk space');
    let done = 0;
    for (const file of this.files) {
      signal.throwIfAborted();
      const target = join(dir, file.name);
      // A file verified earlier (e.g. before a cancel) is kept only if it still hashes correctly.
      if (existsSync(target) && (await sha256File(target, file.size, signal)) === file.sha256) {
        done += file.size;
        this.progress(done);
        continue;
      }
      rmSync(target, { force: true });
      await this.fetchFile(file, target, signal, (bytes) => this.progress(done + bytes));
      done += file.size;
      this.progress(done);
    }
  }

  private async fetchFile(
    file: VoiceModelFile,
    target: string,
    outer: AbortSignal,
    onBytes: (bytes: number) => void,
  ) {
    const fetch = this.options.fetch ?? globalThis.fetch;
    const stallMs = this.options.stallMs ?? 60_000;
    const controller = new AbortController();
    const forward = () => controller.abort(outer.reason);
    outer.addEventListener('abort', forward, { once: true });
    let stall: ReturnType<typeof setTimeout> | undefined;
    const armStall = () => {
      clearTimeout(stall);
      stall = setTimeout(
        () => controller.abort(new VoiceModelDownloadError('network', 'Download stalled')),
        stallMs,
      );
      stall.unref?.();
    };
    const signal = controller.signal;
    const partial = `${target}.partial`;
    let handle: FileHandle | null = null;
    let response: Response | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      armStall();
      let url = voiceModelUrl(file.name);
      for (let redirects = 0; ; redirects++) {
        if (!voiceModelUrlAllowed(url, file.name))
          throw new VoiceModelDownloadError('redirect', 'Redirected to an untrusted address');
        response = await abortable(
          fetch(url, {
            redirect: 'manual',
            credentials: 'omit',
            signal,
            headers: { Accept: 'application/octet-stream', 'User-Agent': 'EzyChat-Lite' },
          }),
          signal,
        ).catch((error: unknown) => {
          if (signal.aborted) throw signal.reason;
          throw new VoiceModelDownloadError(
            'network',
            error instanceof Error ? error.message : 'Network error',
          );
        });
        if (response.url && !voiceModelUrlAllowed(response.url, file.name))
          throw new VoiceModelDownloadError('redirect', 'Unexpected download address');
        if (!REDIRECTS.has(response.status)) break;
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        response = null;
        if (!location || redirects >= MAX_REDIRECTS)
          throw new VoiceModelDownloadError('redirect', 'Too many or invalid redirects');
        url = new URL(location, url).href;
      }
      if (response.status !== 200 || !response.body)
        throw new VoiceModelDownloadError('network', `Download failed (HTTP ${response.status})`);
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) !== file.size)
        throw new VoiceModelDownloadError('verification', 'Unexpected file size');
      try {
        handle = await open(partial, 'w', 0o600);
      } catch {
        throw new VoiceModelDownloadError('write', 'Cannot write the model file');
      }
      reader = response.body.getReader();
      const hash = createHash('sha256');
      let received = 0;
      for (;;) {
        const chunk = await abortable(reader.read(), signal).catch((error: unknown) => {
          if (signal.aborted) throw signal.reason;
          throw new VoiceModelDownloadError(
            'network',
            error instanceof Error ? error.message : 'Network error',
          );
        });
        if (chunk.done) break;
        armStall();
        received += chunk.value.byteLength;
        if (received > file.size)
          throw new VoiceModelDownloadError('verification', 'File is larger than expected');
        hash.update(chunk.value);
        try {
          await handle.write(chunk.value);
        } catch {
          throw new VoiceModelDownloadError('write', 'Cannot write the model file');
        }
        onBytes(received);
      }
      if (received !== file.size)
        throw new VoiceModelDownloadError('verification', 'Incomplete download');
      if (hash.digest('hex') !== file.sha256)
        throw new VoiceModelDownloadError('verification', 'SHA-256 mismatch');
      await handle.sync();
      await handle.close();
      handle = null;
      signal.throwIfAborted();
      await rename(partial, target);
    } finally {
      clearTimeout(stall);
      outer.removeEventListener('abort', forward);
      if (reader) {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      } else void response?.body?.cancel().catch(() => undefined);
      await handle?.close().catch(() => undefined);
      await unlink(partial).catch(() => undefined);
    }
  }
}
