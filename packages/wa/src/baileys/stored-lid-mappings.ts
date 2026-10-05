import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WaContactAlias } from '../types.js';
import { contactAliasPair, normalizeContactJid } from './contact-aliases.js';

// Baileys' useMultiFileAuthState stores key `<id>` of type `lid-mapping` as `lid-mapping-<id>.json`.
// LIDMappingStore writes `<pnUser>` -> "<lidUser>" and `<lidUser>_reverse` -> "<pnUser>".
const FORWARD = /^lid-mapping-(\d+)\.json$/;
const REVERSE = /^lid-mapping-(\d+)_reverse\.json$/;

function readUser(file: string): string | null {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** The linked account's own PN and LID (never aliased). */
function ownJids(authDir: string): Set<string> {
  try {
    const creds = JSON.parse(readFileSync(join(authDir, 'creds.json'), 'utf8')) as {
      me?: { id?: unknown; lid?: unknown };
    };
    return new Set(
      [normalizeContactJid(creds.me?.id), normalizeContactJid(creds.me?.lid)].filter(
        (j): j is string => !!j,
      ),
    );
  } catch {
    return new Set();
  }
}

/**
 * PN-LID pairs WhatsApp already gave this account, read offline from the multi-file auth store
 * (no socket, no `baileys` import) so the server can merge chats at startup. A number's forward file
 * is its current WhatsApp ID; a reverse file only fills numbers without one (an old ID's reverse file
 * can outlive a number that moved). Missing dir returns []; any other directory error throws.
 */
export function readStoredLidMappings(authDir: string): WaContactAlias[] {
  let names: string[];
  try {
    names = readdirSync(authDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const lidOf = new Map<string, string>();
  const reverse = new Map<string, Set<string>>();
  for (const name of names) {
    const forward = FORWARD.exec(name);
    if (forward) {
      const lid = readUser(join(authDir, name));
      if (lid) lidOf.set(forward[1]!, lid);
      continue;
    }
    const back = REVERSE.exec(name);
    if (back) {
      const pn = readUser(join(authDir, name));
      if (pn) reverse.set(pn, (reverse.get(pn) ?? new Set()).add(back[1]!));
    }
  }
  for (const [pn, lids] of reverse) {
    if (!lidOf.has(pn) && lids.size === 1) lidOf.set(pn, [...lids][0]!);
  }
  const own = ownJids(authDir);
  const out: WaContactAlias[] = [];
  for (const [pn, lid] of [...lidOf].sort(([a], [b]) => a.localeCompare(b))) {
    const pair = contactAliasPair(`${pn}@s.whatsapp.net`, `${lid}@lid`);
    if (pair && !own.has(pair.jid) && !own.has(pair.alias))
      out.push({ ...pair, source: 'keystore' });
  }
  return out;
}
