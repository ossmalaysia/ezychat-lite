import { afterEach, describe, expect, it } from 'vitest';
import { MEDIA_UPLOAD_LIMIT_BYTES } from '@ezychat/shared';
import {
  MAX_ATTACHMENTS,
  checkAttachments,
  filesFromTransfer,
  formatBytes,
  hasFiles,
  installFileDropGuard,
  setDownloadDrag,
} from './file-transfer';

/** A file whose `size` reads as `size` without allocating it. */
function sized(name: string, size: number, type = 'application/pdf'): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function fakeTransfer() {
  const data = new Map<string, string>();
  return {
    data,
    dt: {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (k: string, v: string) => data.set(k, v),
    } as unknown as DataTransfer,
  };
}

describe('file transfer', () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => uninstall?.());

  it('tells file drags from text or link drags', () => {
    expect(hasFiles({ types: ['Files'] })).toBe(true);
    expect(hasFiles({ types: ['text/plain', 'text/uri-list'] })).toBe(false);
    expect(hasFiles(null)).toBe(false);
  });

  it('names a pasted screenshot after the paste time and keeps real file names', () => {
    const shot = new File(['p'], 'image.png', { type: 'image/png' });
    const doc = new File(['d'], 'quote.pdf', { type: 'application/pdf' });
    const noName = new File(['j'], '', { type: 'image/jpeg' });
    const files = filesFromTransfer(
      { files: [shot, doc, noName] as unknown as FileList },
      () => new Date(2026, 9, 27, 9, 5, 7),
    );
    expect(files.map((f) => f.name)).toEqual([
      'pasted-20261027-090507.png',
      'quote.pdf',
      'pasted-20261027-090507.jpg',
    ]);
    expect(files[0]!.type).toBe('image/png');
    expect(files[1]).toBe(doc);
    expect(filesFromTransfer(null)).toEqual([]);
  });

  it('refuses empty, too large and too many files before any upload', () => {
    const ok = sized('a.pdf', 10);
    const big = sized('big.mov', MEDIA_UPLOAD_LIMIT_BYTES + 1);
    const empty = sized('empty.txt', 0);
    const r = checkAttachments([ok, big, empty], 0);
    expect(r.accepted).toEqual([ok]);
    expect(r.rejected.map((x) => [x.file.name, x.reason])).toEqual([
      ['big.mov', 'too_large'],
      ['empty.txt', 'empty'],
    ]);
    const full = checkAttachments([sized('b.pdf', 1), sized('c.pdf', 1)], MAX_ATTACHMENTS - 1);
    expect(full.accepted.map((f) => f.name)).toEqual(['b.pdf']);
    expect(full.rejected).toEqual([expect.objectContaining({ reason: 'too_many' })]);
    expect(checkAttachments([sized('max.bin', MEDIA_UPLOAD_LIMIT_BYTES)], 0).accepted).toHaveLength(
      1,
    );
  });

  it('formats sizes for the tray', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(64 * 1024 * 1024)).toBe('64 MB');
    expect(formatBytes(3 * 1024 ** 4)).toBe('3072 GB');
  });

  it('drags a media file out as a download with a safe name and an absolute link', () => {
    const { dt, data } = fakeTransfer();
    setDownloadDrag(dt, { url: '/api/media/abc', name: 'a:b/c.pdf', mime: 'application/pdf' });
    const href = new URL('/api/media/abc', window.location.href).href;
    expect(data.get('DownloadURL')).toBe(`application/pdf:a_b_c.pdf:${href}`);
    expect(data.get('text/uri-list')).toBe(href);
    expect(dt.effectAllowed).toBe('copy');
    const other = fakeTransfer();
    setDownloadDrag(other.dt, { url: '/x', name: '', mime: null });
    expect(other.data.get('DownloadURL')).toMatch(/^application\/octet-stream:file:/);
  });

  it('stops a stray file drop from replacing the app, but leaves drop zones and text alone', () => {
    uninstall = installFileDropGuard(window);
    const drag = (type: string, types: string[], handled = false) => {
      const e = new Event(type, { cancelable: true, bubbles: true }) as DragEvent;
      Object.defineProperty(e, 'dataTransfer', { value: { types, dropEffect: 'copy' } });
      if (handled) e.preventDefault();
      window.dispatchEvent(e);
      return e;
    };
    const stray = drag('dragover', ['Files']);
    expect(stray.defaultPrevented).toBe(true);
    expect(stray.dataTransfer!.dropEffect).toBe('none');
    const zone = drag('dragover', ['Files'], true);
    expect(zone.dataTransfer!.dropEffect).toBe('copy');
    expect(drag('drop', ['Files']).defaultPrevented).toBe(true);
    expect(drag('drop', ['text/plain']).defaultPrevented).toBe(false);
    uninstall();
    uninstall = null;
    expect(drag('drop', ['Files']).defaultPrevented).toBe(false);
  });
});
