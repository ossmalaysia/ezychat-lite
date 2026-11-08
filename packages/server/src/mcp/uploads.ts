import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { Transform, type Readable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileTypeFromFile } from 'file-type';
import type { Logger } from 'pino';
import type { AppContext } from '../context.js';
import { MCP_UPLOAD_MAX_BYTES, MCP_UPLOAD_TTL_MS, type McpUploadResponse } from '@ezychat/shared';
import { ResponseTooLargeError } from '../connectors/mcp/net.js';
import { HttpError, errors } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { MCP_UPLOAD_TYPES } from './media-types.js';

/**
 * Files an MCP client uploads (`POST /mcp/uploads`, design docs/features/mcp-file-upload/design.md)
 * and the send tools then send by `uploadId`. Each upload is streamed to a private file under
 * `<data>/mcp-uploads/` (never held in memory), typed from its bytes, owned by one token and deleted
 * when it is sent, when it expires (1 hour) or when the server starts again.
 */

export { MCP_UPLOAD_TYPES } from './media-types.js';

export interface UploadLimits {
  perHour: { windowMs: number; max: number };
  bytesPerDay: number;
  pendingPerToken: number;
  pendingBytes: number;
  activePerToken: number;
  activeTotal: number;
  minFreeBytes: number;
}

export const UPLOAD_LIMITS: Readonly<UploadLimits> = {
  /** Uploads started per token per hour (failed ones count too). */
  perHour: { windowMs: 60 * 60_000, max: 30 },
  /** Bytes received per token in 24 hours (failed and refused uploads count too). */
  bytesPerDay: 2 * 1024 * 1024 * 1024,
  /** Uploads of one token waiting to be sent. */
  pendingPerToken: 10,
  /** Bytes of every token's uploads waiting to be sent. */
  pendingBytes: 1024 * 1024 * 1024,
  /** Uploads receiving at the same time, per token and in total. */
  activePerToken: 2,
  activeTotal: 4,
  /** Free disk space the data folder keeps after an upload or download. */
  minFreeBytes: 1024 * 1024 * 1024,
};

/** An upload or link download stops after this long without data, or this long in total. */
export const UPLOAD_TIMEOUTS = { idleMs: 60_000, totalMs: 30 * 60_000 };

export interface McpUpload {
  id: string;
  tokenId: number;
  /** Absolute path of the private file. */
  path: string;
  name: string;
  mime: string;
  ext: string;
  size: number;
  expiresAt: number;
}

const UPLOAD_ID = /^upl_[a-f0-9]{32}$/;
const MB = 1024 * 1024;

/** A file name safe to show: no folders, no control characters, at most 120 characters. */
export function cleanUploadName(raw: string | undefined | null): string {
  let name = raw ?? '';
  try {
    // X-File-Name may be percent-encoded so a name outside ASCII fits in a header.
    name = decodeURIComponent(name);
  } catch {
    // not encoded
  }
  const base =
    name
      .split(/[/\\]/)
      .pop()!
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '')
      .trim()
      .slice(0, 120) || 'file';
  return base === '.' || base === '..' ? 'file' : base;
}

/** Counts bytes through a stream and fails it once more than `max` arrive. */
class ByteCounter extends Transform {
  bytes = 0;
  constructor(
    private readonly max: number,
    private readonly onChunk?: () => void,
  ) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
    this.onChunk?.();
    this.bytes += chunk.length;
    if (this.bytes > this.max) return done(new TooLargeError());
    done(null, chunk);
  }
}

export class TooLargeError extends Error {
  constructor() {
    super('too large');
    this.name = 'TooLargeError';
  }
}

const tooLarge = (max: number) =>
  new HttpError(413, 'upload_too_large', `The file is larger than ${Math.floor(max / MB)} MB.`);

const dailyLimit = () =>
  new HttpError(
    429,
    'upload_daily_limit',
    'This token reached its daily amount of uploaded files; try again tomorrow.',
  );

export interface McpUploadStore {
  /** Receives one upload of `tokenId`; 400/408/413/415/429/507 HttpErrors for a refused one. */
  receive(
    tokenId: number,
    body: Readable,
    opts: { name: string | undefined; declaredLength?: number },
  ): Promise<McpUploadResponse>;
  /** The token's own upload that has not expired, or null ("not found" for every other case). */
  get(tokenId: number, id: string): McpUpload | null;
  /**
   * Takes the token's upload out of the store for one send, so a second send or the expiry sweep
   * cannot touch its file meanwhile; null when there is none. The send moves the file, or gives the
   * upload back with `restore`.
   */
  take(tokenId: number, id: string): McpUpload | null;
  /** Gives back an upload a send did not use (refused); its file is still there. */
  restore(upload: McpUpload): void;
  /**
   * Streams a link download of `tokenId` (at most `max` bytes) into a new private file, under the
   * same transfer slots, daily byte budget and disk checks as an upload; the caller moves or deletes
   * it (`discard`). Throws TooLargeError above `max`, IncompleteError when the stream broke, HttpError
   * for a refusal.
   */
  writeTemp(tokenId: number, body: Readable, max: number): Promise<{ path: string; size: number }>;
  discard(path: string): void;
  /** Deletes expired uploads (also on a timer). */
  sweep(): void;
  shutdown(): void;
}

/** The body stopped before it ended (the client went away, the link broke). */
export class IncompleteError extends Error {
  constructor() {
    super('incomplete');
    this.name = 'IncompleteError';
  }
}

export function createMcpUploadStore(
  dir: string,
  deps: {
    log: Logger;
    now?: () => number;
    freeBytes?: (dir: string) => number;
    /** Tests: smaller limits than the real ones. */
    limits?: Partial<UploadLimits>;
    maxBytes?: number;
    timeouts?: Partial<typeof UPLOAD_TIMEOUTS>;
  },
): McpUploadStore {
  const now = deps.now ?? Date.now;
  const limits = { ...UPLOAD_LIMITS, ...deps.limits };
  const maxUpload = deps.maxBytes ?? MCP_UPLOAD_MAX_BYTES;
  const timeouts = { ...UPLOAD_TIMEOUTS, ...deps.timeouts };
  const log = deps.log;
  const freeBytes =
    deps.freeBytes ??
    ((d: string) => {
      const s = statfsSync(d);
      return Number(s.bavail) * Number(s.bsize);
    });
  // Uploads do not outlive a restart: whatever is left from before is deleted.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const uploads = new Map<string, McpUpload>();
  const perHour = new WindowLimiter({ ...limits.perHour, now });
  /** Bytes received per token, newest last: [time, bytes]. */
  const received = new Map<number, Array<[number, number]>>();
  const active = new Map<number, number>();
  let activeTotal = 0;
  /** Bytes the transfers in progress may still write (their limit): counted as used disk. */
  let reserved = 0;

  const remove = (path: string) => rmSync(path, { force: true });

  function bytesToday(tokenId: number): number {
    const since = now() - 24 * 60 * 60_000;
    const list = (received.get(tokenId) ?? []).filter(([t]) => t > since);
    received.set(tokenId, list);
    return list.reduce((sum, [, b]) => sum + b, 0);
  }

  function pending(tokenId?: number): McpUpload[] {
    return [...uploads.values()].filter((u) => tokenId === undefined || u.tokenId === tokenId);
  }

  const storageFull = (message: string) => new HttpError(507, 'upload_storage_full', message);

  /** The free disk space after every transfer in progress and this one, or a 507. */
  function requireDisk(size: number) {
    let free: number;
    try {
      free = freeBytes(dir);
    } catch {
      return; // unknown: the write itself fails when the disk is full
    }
    if (free - reserved - size < limits.minFreeBytes)
      throw storageFull(
        'Not enough free disk space on the computer that runs EzyChat for this file.',
      );
  }

  /** The daily budget left for `tokenId`, or a 429 when it is used up. */
  function budgetLeft(tokenId: number): number {
    const left = limits.bytesPerDay - bytesToday(tokenId);
    if (left <= 0) throw dailyLimit();
    return left;
  }

  /**
   * One transfer slot of `tokenId` with `size` bytes reserved; the write counts what arrived against
   * the token's daily budget (also when it fails) and frees the slot.
   */
  async function transfer(
    tokenId: number,
    body: Readable,
    max: number,
    size: number,
  ): Promise<{ path: string; size: number }> {
    const mine = active.get(tokenId) ?? 0;
    if (mine >= limits.activePerToken || activeTotal >= limits.activeTotal)
      throw errors.rateLimited(5);
    requireDisk(size);
    active.set(tokenId, mine + 1);
    activeTotal++;
    reserved += size;
    let bytes = 0;
    try {
      return await write(body, max, (n) => (bytes = n));
    } finally {
      active.set(tokenId, (active.get(tokenId) ?? 1) - 1);
      activeTotal--;
      reserved -= size;
      received.set(tokenId, [...(received.get(tokenId) ?? []), [now(), bytes]]);
    }
  }

  /** Streams into a new private file; counts bytes; deletes the file on any failure. */
  async function write(
    body: Readable,
    max: number,
    onBytes: (bytes: number) => void,
  ): Promise<{ path: string; size: number }> {
    const path = join(dir, `${randomBytes(16).toString('hex')}.bin`);
    // Fastify has no request timeout: a sender that stalls or trickles never holds a slot for long.
    const abort = new AbortController();
    const idle = setTimeout(() => abort.abort(), timeouts.idleMs);
    const counter = new ByteCounter(max, () => idle.refresh());
    const total = setTimeout(() => abort.abort(), timeouts.totalMs);
    try {
      await pipeline(body, counter, createWriteStream(path, { flags: 'wx', mode: 0o600 }), {
        signal: abort.signal,
      });
    } catch (err) {
      remove(path);
      if (counter.bytes > max || err instanceof ResponseTooLargeError) throw new TooLargeError();
      if (abort.signal.aborted)
        throw new HttpError(408, 'upload_timeout', 'The upload was too slow and was stopped.');
      if ((err as { code?: string }).code === 'ENOSPC')
        throw storageFull('The disk of the computer that runs EzyChat is full.');
      throw new IncompleteError();
    } finally {
      clearTimeout(idle);
      clearTimeout(total);
      // the caller counts what arrived, also for a failed upload
      onBytes(counter.bytes);
    }
    return { path, size: counter.bytes };
  }

  function sweep() {
    const t = now();
    for (const u of uploads.values()) {
      if (u.expiresAt > t) continue;
      uploads.delete(u.id);
      remove(u.path);
      log.info({ tokenId: u.tokenId, uploadId: u.id }, 'mcp upload expired');
    }
  }
  const timer = setInterval(sweep, 5 * 60_000);
  timer.unref();

  function get(tokenId: number, id: string): McpUpload | null {
    if (!UPLOAD_ID.test(id)) return null;
    const u = uploads.get(id);
    if (!u || u.tokenId !== tokenId) return null;
    if (u.expiresAt <= now()) {
      uploads.delete(id);
      remove(u.path);
      return null;
    }
    return u;
  }

  return {
    async receive(tokenId, body, opts) {
      sweep();
      const hit = perHour.hit(String(tokenId));
      if (!hit.allowed) throw errors.rateLimited(hit.retryAfterSec);
      const budget = budgetLeft(tokenId);
      if (pending(tokenId).length >= limits.pendingPerToken)
        throw new HttpError(
          429,
          'upload_pending_limit',
          `This token has ${limits.pendingPerToken} uploads waiting; send them or wait until they expire.`,
        );
      const max = Math.min(maxUpload, budget);
      const declared = opts.declaredLength;
      if (declared !== undefined && declared > max)
        throw max < maxUpload && declared <= maxUpload ? dailyLimit() : tooLarge(maxUpload);
      const size = declared ?? max;
      const waiting = pending().reduce((sum, u) => sum + u.size, 0);
      if (waiting + reserved + size > limits.pendingBytes)
        throw storageFull('Too many uploaded files are waiting to be sent; try again later.');
      const started = now();
      let file: { path: string; size: number };
      try {
        file = await transfer(tokenId, body, max, size);
      } catch (err) {
        if (err instanceof TooLargeError) throw max < maxUpload ? dailyLimit() : tooLarge(max);
        if (err instanceof IncompleteError)
          throw new HttpError(
            400,
            'upload_incomplete',
            'The upload stopped before the whole file arrived.',
          );
        throw err;
      }
      if (!file.size) {
        remove(file.path);
        throw errors.validation('The file is empty.');
      }
      const type = await fileTypeFromFile(file.path).catch(() => undefined);
      const ext = type ? MCP_UPLOAD_TYPES.get(type.mime) : undefined;
      if (!type || !ext) {
        remove(file.path);
        throw new HttpError(
          415,
          'upload_type',
          'Only JPEG, PNG or WebP images, PDF or Word (.docx) files and MP4 videos can be uploaded.',
        );
      }
      const upload: McpUpload = {
        id: `upl_${randomBytes(16).toString('hex')}`,
        tokenId,
        path: file.path,
        name: cleanUploadName(opts.name),
        mime: type.mime,
        ext,
        size: file.size,
        expiresAt: now() + MCP_UPLOAD_TTL_MS,
      };
      uploads.set(upload.id, upload);
      // ids, type and size only: never the name or the content
      log.info(
        { tokenId, uploadId: upload.id, type: upload.mime, size: upload.size, ms: now() - started },
        'mcp upload',
      );
      return {
        uploadId: upload.id,
        name: upload.name,
        type: upload.mime,
        size: upload.size,
        expiresAt: upload.expiresAt,
      };
    },

    get,

    take(tokenId, id) {
      const u = get(tokenId, id);
      if (u) uploads.delete(id);
      return u;
    },

    restore(upload) {
      if (upload.expiresAt <= now() || !existsSync(upload.path)) remove(upload.path);
      else uploads.set(upload.id, upload);
    },

    async writeTemp(tokenId, body, max) {
      try {
        const limit = Math.min(max, budgetLeft(tokenId));
        try {
          return await transfer(tokenId, body, limit, limit);
        } catch (err) {
          if (err instanceof TooLargeError && limit < max) throw dailyLimit();
          throw err;
        }
      } finally {
        // a refused or failed download never leaves its connection open
        body.destroy();
      }
    },

    discard: remove,
    sweep,

    shutdown() {
      clearInterval(timer);
    },
  };
}

declare module '../context.js' {
  interface Services {
    mcpUploads?: McpUploadStore;
  }
}

/** The server's one upload store (`<data>/mcp-uploads/`), created on first use. */
export function mcpUploadStore(ctx: AppContext): McpUploadStore {
  return (ctx.services.mcpUploads ??= createMcpUploadStore(
    join(ctx.config.dataDir, 'mcp-uploads'),
    { log: ctx.log.child({ mod: 'mcp' }) },
  ));
}
