import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { WaContactAlias } from '../types.js';
import { contactAliasPair, normalizeContactJid } from './contact-aliases.js';

// Baileys' useMultiFileAuthState stores key `<id>` of type `lid-mapping` as `lid-mapping-<id>.json`.
// LIDMappingStore writes `<pnUser>` -> "<lidUser>" and `<lidUser>_reverse` -> "<pnUser>".
const FORWARD = /^lid-mapping-(\d+)\.json$/;
const REVERSE = /^lid-mapping-(\d+)_reverse\.json$/;

// A mapping file holds one short JSON string; anything bigger is not one.
const MAX_FILE_BYTES = 1024;

function readUser(file: string): string | null {
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The linked account's own PN and LID (never aliased). Fails closed: without a readable creds.json
 * carrying `me.id` the account's own identities cannot be excluded, so refuse to guess.
 */
function ownJids(authDir: string): Set<string> {
  let me: { id?: unknown; lid?: unknown } | undefined;
  try {
    me = (JSON.parse(readFileSync(join(authDir, 'creds.json'), 'utf8')) as { me?: typeof me }).me;
  } catch {
    me = undefined;
  }
  const own = normalizeContactJid(me?.id);
  if (!own) throw new Error('wa-auth creds.json missing or has no account id');
  const set = new Set([own]);
  const lid = normalizeContactJid(me?.lid);
  if (lid) set.add(lid);
  return set;
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
  if (lidOf.size === 0) return [];
  const own = ownJids(authDir);
  // A LID claimed by more than one number is ambiguous: emitting it would join two people's chats.
  const claims = new Map<string, number>();
  for (const lid of lidOf.values()) claims.set(lid, (claims.get(lid) ?? 0) + 1);
  const out: WaContactAlias[] = [];
  for (const [pn, lid] of [...lidOf].sort(([a], [b]) => a.localeCompare(b))) {
    if (claims.get(lid) !== 1) continue;
    const pair = contactAliasPair(`${pn}@s.whatsapp.net`, `${lid}@lid`);
    if (pair && !own.has(pair.jid) && !own.has(pair.alias))
      out.push({ ...pair, source: 'keystore' });
  }
  return out;
}
