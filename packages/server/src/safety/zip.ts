/**
 * Reads only a ZIP file's central directory: the names of the files inside and whether each is
 * password-protected. Nothing is extracted, decompressed or run. Every offset is bounds-checked and
 * the walk stops after `maxEntries`, so a crafted or broken archive answers `ok: false` (the caller
 * treats that as "can't inspect") instead of throwing or looping.
 */

export interface ZipEntry {
  name: string;
  encrypted: boolean;
}

export interface ZipListing {
  /** False when the directory could not be read (corrupt, ZIP64, truncated). */
  ok: boolean;
  entries: ZipEntry[];
  /** True when the archive holds more entries than were read. */
  truncated: boolean;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
/** End-of-central-directory record (22 bytes) plus the longest possible comment. */
const EOCD_SEARCH = 22 + 0xffff;

export const ZIP_MAX_ENTRIES = 2000;

const failed: ZipListing = { ok: false, entries: [], truncated: false };

export function listZip(buf: Buffer, maxEntries = ZIP_MAX_ENTRIES): ZipListing {
  if (buf.length < 22) return failed;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - EOCD_SEARCH); i--)
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  if (eocd < 0) return failed;
  const total = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  // ZIP64 keeps the real values elsewhere: not read here.
  if (total === 0xffff || dirOffset === 0xffffffff || dirSize === 0xffffffff) return failed;
  if (dirOffset + dirSize > eocd) return failed;
  const entries: ZipEntry[] = [];
  let p = dirOffset;
  const end = dirOffset + dirSize;
  while (entries.length < Math.min(total, maxEntries)) {
    if (p + 46 > end || buf.readUInt32LE(p) !== CENTRAL_SIG) return failed;
    const flags = buf.readUInt16LE(p + 8);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const next = p + 46 + nameLength + extraLength + commentLength;
    if (next > end) return failed;
    // Bit 11 = UTF-8 name; older tools write CP437, which reads fine as latin1 for the extensions.
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLength);
    entries.push({ name, encrypted: (flags & 0x1) === 1 });
    p = next;
  }
  return { ok: true, entries, truncated: total > entries.length };
}
