import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** Replaces anything outside [a-zA-Z0-9_-] with '_' (prevents path traversal / odd file names). */
export function sanitizeSegment(s: string): string {
  const out = s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return out || '_';
}

/**
 * Stores media files under `<root>/<sanitized chat>/<sanitized msg id>.<ext>`.
 * Paths returned by save() are relative to root (stored in messages.media_path).
 */
export class MediaStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  save(chatJid: string, msgId: string, buf: Buffer, ext: string): string {
    const dir = sanitizeSegment(chatJid);
    const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase() || 'bin';
    const rel = `${dir}/${sanitizeSegment(msgId)}.${cleanExt}`;
    mkdirSync(join(this.root, dir), { recursive: true });
    writeFileSync(join(this.root, rel), buf);
    return rel;
  }

  /** Absolute path of a stored relative path; throws if it escapes the root. */
  abs(rel: string): string {
    const p = resolve(this.root, rel);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error('media path escapes store root');
    return p;
  }
}
