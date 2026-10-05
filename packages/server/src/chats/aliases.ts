import type { Logger } from 'pino';
import { contactAliasPair, normalizeContactJid, type WaAliasSource } from '@wa-team-inbox/wa';
import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';

declare module '../context.js' {
  interface Services {
    /** persisted PN → LID routing (chats/aliases.ts) */
    aliases?: AliasStore;
  }
}

export type AliasSource = WaAliasSource;

export type LearnOutcome =
  | { kind: 'ignored' }
  | { kind: 'unchanged'; pn: string; lid: string }
  | { kind: 'added'; pn: string; lid: string }
  | { kind: 'repointed'; pn: string; lid: string; previous: string };

/** `60123:4@s.whatsapp.net` / `60123@c.us` → `60123@s.whatsapp.net`; anything else → null. */
export function normalizePn(jid: string | null | undefined): string | null {
  const n = normalizeContactJid(jid);
  return n && !n.endsWith('@lid') ? n : null;
}

/** `123:9@lid` → `123@lid`; anything else → null. */
export function normalizeLid(jid: string | null | undefined): string | null {
  const n = normalizeContactJid(jid);
  return n?.endsWith('@lid') ? n : null;
}

/** An explicit WhatsApp pair as {pn, lid}; null unless one side is a PN and the other a LID. */
export function orientPair(p: { jid: string; alias: string }): { pn: string; lid: string } | null {
  const pair = contactAliasPair(p.jid, p.alias);
  return pair ? { pn: pair.jid, lid: pair.alias } : null;
}

const digits = (pn: string) => pn.slice(0, pn.indexOf('@'));

export interface AliasStoreOptions {
  /** the linked number; never aliased */
  ownJid(): string | null;
  now(): number;
  log: Pick<Logger, 'warn' | 'info'>;
}

/**
 * Persisted PN → LID routing (`jid_aliases`) with an in-memory cache. The LID is canonical once
 * known. Learning and routing never create, merge or delete chats: existing duplicates are merged
 * only by the startup identity migration (identity-migration.ts).
 */
export class AliasStore {
  /** PN → LID */
  private readonly canonical = new Map<string, string>();
  /** LID → its PNs */
  private readonly byLid = new Map<string, Set<string>>();
  /** PNs that moved to another person (rule 3): their old chat is never merged or routed to */
  private readonly repointed = new Set<string>();

  constructor(
    private readonly db: DB,
    private readonly opts: AliasStoreOptions,
  ) {
    this.reload();
  }

  reload(): void {
    this.canonical.clear();
    this.byLid.clear();
    this.repointed.clear();
    const rows = this.db
      .prepare('SELECT alias_jid, canonical_jid, repointed_from FROM jid_aliases')
      .all() as Array<{ alias_jid: string; canonical_jid: string; repointed_from: string | null }>;
    for (const r of rows) this.remember(r.alias_jid, r.canonical_jid, r.repointed_from !== null);
  }

  private remember(pn: string, lid: string, repointed: boolean): void {
    const old = this.canonical.get(pn);
    if (old) this.byLid.get(old)?.delete(pn);
    this.canonical.set(pn, lid);
    const set = this.byLid.get(lid) ?? new Set<string>();
    set.add(pn);
    this.byLid.set(lid, set);
    if (repointed) this.repointed.add(pn);
    else this.repointed.delete(pn);
  }

  private hasChat(jid: string): boolean {
    return this.db.prepare('SELECT 1 FROM chats WHERE jid = ?').get(jid) !== undefined;
  }

  /** Canonical identity: the LID for a PN whose LID is known, else `jid` unchanged. */
  resolve(jid: string): string {
    const pn = normalizePn(jid);
    return (pn && this.canonical.get(pn)) || jid;
  }

  /**
   * The chat a DM JID belongs to now: the LID chat when it exists, else an existing (not re-pointed)
   * phone-number chat of the same person — re-keyed to the LID by the next startup — else the LID
   * for a known PN (new chats are LID-keyed), else `jid`. Never creates or merges anything.
   */
  route(jid: string): string {
    const pn = normalizePn(jid);
    const lid = pn ? this.canonical.get(pn) : normalizeLid(jid);
    if (!lid) return jid;
    if (this.hasChat(lid)) return lid;
    const pnChat = this.aliasesOf(lid).find((a) => !this.repointed.has(a) && this.hasChat(a));
    return pnChat ?? (pn ? lid : jid);
  }

  /** True when `jid` is a phone-number JID that was re-pointed to another person (its chat is the old owner's). */
  movedAway(jid: string): boolean {
    const pn = normalizePn(jid);
    return pn !== null && this.repointed.has(pn);
  }

  /** Every PN that currently routes to `lid`, sorted. */
  aliasesOf(lid: string): string[] {
    return [...(this.byLid.get(lid) ?? [])].sort((a, b) => a.localeCompare(b));
  }

  /** `[canonical, ...its PNs]`: every JID of the person, for name sync. */
  group(jid: string): string[] {
    const canonical = this.resolve(jid);
    return [canonical, ...this.aliasesOf(canonical)];
  }

  learn(pair: { jid: string; alias: string }, source: AliasSource): LearnOutcome {
    const p = orientPair(pair);
    if (!p) return { kind: 'ignored' };
    const own = normalizePn(this.opts.ownJid());
    if (own && p.pn === own) return { kind: 'ignored' };
    const previous = this.canonical.get(p.pn);
    if (previous === p.lid) return { kind: 'unchanged', ...p };
    // Stale history must never move a number to another person; only live evidence re-points.
    if (previous && source === 'history') return { kind: 'unchanged', pn: p.pn, lid: previous };
    const phone = digits(p.pn);
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO jid_aliases (alias_jid, canonical_jid, source, learned_at, repointed_from)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(alias_jid) DO UPDATE SET canonical_jid = excluded.canonical_jid,
             source = excluded.source, learned_at = excluded.learned_at,
             repointed_from = excluded.repointed_from`,
        )
        .run(p.pn, p.lid, source, this.opts.now(), previous ?? null);
      if (previous) {
        this.db
          .prepare('UPDATE chats SET phone = NULL WHERE jid = ? AND phone = ?')
          .run(previous, phone);
        // Search also matches contacts.phone: the old person must not come up for the moved number.
        this.db
          .prepare('UPDATE contacts SET phone = NULL WHERE jid = ? AND phone = ?')
          .run(previous, phone);
      }
      this.db.prepare('UPDATE chats SET phone = ? WHERE jid = ?').run(phone, p.lid);
    })();
    this.remember(p.pn, p.lid, previous !== undefined);
    if (previous) {
      // Number recycled / re-registered: future routing only. Never join `previous` and `lid`.
      this.opts.log.warn(
        { pn: p.pn, from: previous, to: p.lid, source },
        'phone number moved to a different WhatsApp ID',
      );
      return { kind: 'repointed', ...p, previous };
    }
    if (this.hasChat(p.pn) && this.hasChat(p.lid)) {
      this.opts.log.info(
        { pn: p.pn, lid: p.lid, source },
        'phone-number chat stays separate until the next start merges it',
      );
    }
    return { kind: 'added', ...p };
  }

  /** Aliases whose PN still has its own chat row (and was not re-pointed): merged at startup. */
  pendingMerges(): Array<{ from: string; to: string }> {
    return this.db
      .prepare(
        `SELECT a.alias_jid AS "from", a.canonical_jid AS "to" FROM jid_aliases a
         JOIN chats c ON c.jid = a.alias_jid
         WHERE a.repointed_from IS NULL ORDER BY a.learned_at, a.alias_jid`,
      )
      .all() as Array<{ from: string; to: string }>;
  }
}

export function createAliasStore(ctx: AppContext): AliasStore {
  return new AliasStore(ctx.db, {
    ownJid: () => ctx.wa.status.me?.jid ?? null,
    now: Date.now,
    log: ctx.log.child({ mod: 'contacts' }),
  });
}

export function getAliases(ctx: AppContext): AliasStore {
  const s = ctx.services.aliases;
  if (!s) throw new Error('alias store not initialized');
  return s;
}
