import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const LIST_FILE = 'list-v1.json';
export const SIG_FILE = 'list-v1.json.sig';

/** Writes a temporary file next to `path`, then renames it over `path` (never a half file). */
export function writeAtomic(path: string, bytes: Buffer): void {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * The local copy in `<data>/connectors/`: `list-v1.json`, `list-v1.json.sig` (the exact bytes that
 * were checked) and `icons/<file>`. Only the list module writes here.
 */
export class ListStore {
  readonly dir: string;
  readonly iconsDir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'connectors');
    this.iconsDir = join(this.dir, 'icons');
  }

  /** The saved list and signature, or null when either is missing or unreadable. */
  read(): { list: Buffer; sig: Buffer } | null {
    try {
      const list = join(this.dir, LIST_FILE);
      const sig = join(this.dir, SIG_FILE);
      if (!existsSync(list) || !existsSync(sig)) return null;
      return { list: readFileSync(list), sig: readFileSync(sig) };
    } catch {
      return null;
    }
  }

  icon(file: string): Buffer | null {
    try {
      return readFileSync(join(this.iconsDir, file));
    } catch {
      return null;
    }
  }

  /**
   * Saves a checked list: new icons first, then the signature, then the list; then removes icons
   * the list no longer names.
   */
  save(
    list: Buffer,
    sig: Buffer,
    newIcons: ReadonlyMap<string, Buffer>,
    keep: ReadonlySet<string>,
  ) {
    mkdirSync(this.iconsDir, { recursive: true });
    for (const [file, bytes] of newIcons) writeAtomic(join(this.iconsDir, file), bytes);
    writeAtomic(join(this.dir, SIG_FILE), sig);
    writeAtomic(join(this.dir, LIST_FILE), list);
    for (const file of readdirSync(this.iconsDir))
      if (!keep.has(file)) rmSync(join(this.iconsDir, file), { force: true });
  }
}
