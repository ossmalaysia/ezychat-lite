import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import {
  ConnectorEntry,
  ConnectorId,
  SUPPORTED_CONNECTOR_SCHEMA_VERSIONS,
  type ConnectorIcon,
} from '@ezychat/shared';

/** DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows it. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Public keys from base64 raw Ed25519 keys; anything that is not a 32-byte key is skipped. */
export function publicKeys(base64Keys: readonly string[]): KeyObject[] {
  const keys: KeyObject[] = [];
  for (const text of base64Keys) {
    const raw = Buffer.from(text, 'base64');
    if (raw.length !== 32) continue;
    try {
      keys.push(
        createPublicKey({
          key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
          format: 'der',
          type: 'spki',
        }),
      );
    } catch {
      // not a valid curve point: never accepts a signature
    }
  }
  return keys;
}

/** True when any key verifies the base64 Ed25519 signature `sigText` of the exact `bytes`. */
export function signatureValid(
  bytes: Buffer,
  sigText: Buffer,
  keys: readonly KeyObject[],
): boolean {
  const text = sigText.toString('utf8').trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
  const signature = Buffer.from(text, 'base64');
  if (signature.length !== 64) return false;
  return keys.some((key) => {
    try {
      return verify(null, bytes, key, signature);
    } catch {
      return false;
    }
  });
}

export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * An icon is served to every signed-in browser, so only plain images pass: a PNG (by its magic
 * bytes) or an SVG without scripts, event handler attributes or `javascript:` links. The file
 * extension must match the content.
 */
export function iconContentOk(file: string, bytes: Buffer): boolean {
  if (file.endsWith('.png')) return bytes.subarray(0, 8).equals(PNG_MAGIC);
  if (!file.endsWith('.svg')) return false;
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) return false;
  const text = bytes.toString('utf8');
  if (!/<svg[\s>]/i.test(text)) return false;
  if (/<script/i.test(text)) return false;
  if (/[\s"'/]on[a-z]+\s*=/i.test(text)) return false;
  if (/javascript\s*:/i.test(text)) return false;
  return true;
}

export const iconContentType = (file: string): 'image/png' | 'image/svg+xml' =>
  file.endsWith('.png') ? 'image/png' : 'image/svg+xml';

export interface ParsedEntries {
  entries: ConnectorEntry[];
  /** Entries with a schemaVersion this app does not know (never shown). */
  hidden: number;
  /** Entries that failed their checks, or repeated an id (left out). */
  skipped: Array<string | null>;
}

/** Reads the entries one by one: one bad or newer entry never blocks the others. */
export function parseEntries(raw: readonly unknown[]): ParsedEntries {
  const result: ParsedEntries = { entries: [], hidden: 0, skipped: [] };
  const seen = new Set<string>();
  for (const item of raw) {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const id = ConnectorId.safeParse(record.id).success ? (record.id as string) : null;
    const version = record.schemaVersion;
    if (typeof version === 'number' && !SUPPORTED_CONNECTOR_SCHEMA_VERSIONS.includes(version)) {
      result.hidden++;
      continue;
    }
    const parsed = ConnectorEntry.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.id)) {
      result.skipped.push(id);
      continue;
    }
    seen.add(parsed.data.id);
    result.entries.push(parsed.data);
  }
  return result;
}

/**
 * The icons the entries reference, one per file name. Two entries naming one file with different
 * hashes is a broken list (null).
 */
export function referencedIcons(
  entries: readonly ConnectorEntry[],
): Map<string, ConnectorIcon> | null {
  const icons = new Map<string, ConnectorIcon>();
  for (const entry of entries) {
    if (!entry.icon) continue;
    const known = icons.get(entry.icon.file);
    if (known && (known.sha256 !== entry.icon.sha256 || known.size !== entry.icon.size))
      return null;
    icons.set(entry.icon.file, entry.icon);
  }
  return icons;
}
