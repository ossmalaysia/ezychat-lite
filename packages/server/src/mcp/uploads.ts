import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, rmSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { Transform, type Readable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileTypeFromFile } from 'file-type';
import type { Logger } from 'pino';
import type { AppContext } from '../context.js';
import { MCP_UPLOAD_MAX_BYTES, MCP_UPLOAD_TTL_MS, type McpUploadResponse } from '@ezychat/shared';
import { HttpError, errors } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';

/**
 * Files an MCP client uploads (`POST /mcp/uploads`, design docs/features/mcp-file-upload/design.md)
 * and the send tools then send by `uploadId`. Each upload is streamed to a private file under
 * `<data>/mcp-uploads/` (never held in memory), typed from its bytes, owned by one token and deleted
 * when it is sent, when it expires (1 hour) or when the server starts again.
 */

/** Types an upload may have (read from the bytes), with the extension it is sent with. */
export const MCP_UPLOAD_TYPES: ReadonlyMap<string, string> = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['video/mp4', 'mp4'],
]);

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
  constructor(private readonly max: number) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
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
  /** Receives one upload of `tokenId`; 413/415/429/400/507 HttpErrors for a refused one. */
  receive(
    tokenId: number,
    body: Readable,
    opts: { name: string | undefined; declaredLength?: number },
  ): Promise<McpUploadResponse>;
  /** The token's own upload that has not expired, or null ("not found" for every other case). */
  get(tokenId: number, id: string): McpUpload | null;
  /** Forgets an upload that was sent (its file was moved) and removes whatever is left of it. */
  consume(id: string): void;
  /**
   * Streams `body` (at most `max` bytes) into a new private file for a link download; the caller
   * moves or deletes it (`discard`). Throws TooLargeError above `max`, HttpError 507 when the disk
   * is nearly full.
   */
  writeTemp(body: Readable, max: number): Promise<{ path: string; size: number }>;
  discard(path: string): void;
  /** Deletes expired uploads (also on a timer). */
  sweep(): void;
  shutdown(): void;
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
  },
): McpUploadStore {
  const now = deps.now ?? Date.now;
  const limits = { ...UPLOAD_LIMITS, ...deps.limits };
  const maxUpload = deps.maxBytes ?? MCP_UPLOAD_MAX_BYTES;
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

  function requireDisk(size: number) {
    let free: number;
    try {
      free = freeBytes(dir);
    } catch {
      return; // unknown: the write itself fails when the disk is full
    }
    if (free - size < limits.minFreeBytes)
      throw new HttpError(
        507,
        'upload_storage_full',
        'Not enough free disk space on the computer that runs EzyChat for this file.',
      );
  }

  /** Streams into a new private file; counts bytes; deletes the file on any failure. */
  async function write(
    body: Readable,
    max: number,
    onBytes?: (bytes: number) => void,
  ): Promise<{ path: string; size: number }> {
    const path = join(dir, `${randomBytes(16).toString('hex')}.bin`);
    const counter = new ByteCounter(max);
    try {
      await pipeline(body, counter, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
    } catch (err) {
      remove(path);
      if (counter.bytes > max) throw new TooLargeError();
      throw err;
    } finally {
      // the caller counts what arrived, also for a failed upload
      onBytes?.(counter.bytes);
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

  return {
    async receive(tokenId, body, opts) {
      sweep();
      const hit = perHour.hit(String(tokenId));
      if (!hit.allowed) throw errors.rateLimited(hit.retryAfterSec);
      const budget = limits.bytesPerDay - bytesToday(tokenId);
      if (budget <= 0) throw dailyLimit();
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
      const waiting = pending().reduce((sum, u) => sum + u.size, 0);
      if (waiting + (declared ?? max) > limits.pendingBytes)
        throw new HttpError(
          507,
          'upload_storage_full',
          'Too many uploaded files are waiting to be sent; try again later.',
        );
      requireDisk(declared ?? max);
      const mine = active.get(tokenId) ?? 0;
      if (mine >= limits.activePerToken || activeTotal >= limits.activeTotal)
        throw errors.rateLimited(5);
      active.set(tokenId, mine + 1);
      activeTotal++;
      const started = now();
      let file: { path: string; size: number };
      let bytes = 0;
      try {
        file = await write(body, max, (n) => (bytes = n));
      } catch (err) {
        if (err instanceof TooLargeError) throw max < maxUpload ? dailyLimit() : tooLarge(max);
        throw err;
      } finally {
        active.set(tokenId, (active.get(tokenId) ?? 1) - 1);
        activeTotal--;
        received.set(tokenId, [...(received.get(tokenId) ?? []), [now(), bytes]]);
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

    get(tokenId, id) {
      if (!UPLOAD_ID.test(id)) return null;
      const u = uploads.get(id);
      if (!u || u.tokenId !== tokenId) return null;
      if (u.expiresAt <= now()) {
        uploads.delete(id);
        remove(u.path);
        return null;
      }
      return u;
    },

    consume(id) {
      const u = uploads.get(id);
      if (!u) return;
      uploads.delete(id);
      remove(u.path);
    },

    async writeTemp(body, max) {
      requireDisk(max);
      return write(body, max);
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
