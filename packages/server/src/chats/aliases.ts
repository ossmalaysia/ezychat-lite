import type { Logger } from 'pino';
import { contactAliasPair, normalizeContactJid, type WaAliasSource } from '@ezychat/wa';
import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';
import { chatKey, parseChatKey } from '../inboxes/keys.js';
import { existingChatKeys } from './repo.js';

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

function tryParseKey(key: string): { inboxId: number; waJid: string } | null {
  try {
    return parseChatKey(key);
  } catch {
    return null;
  }
}

export interface AliasStoreOptions {
  /** The own numbers (and LIDs) of every inbox, linked now or before; never aliased. */
  ownJids?(): Iterable<string>;
  /** @deprecated single-inbox form of ownJids */
  ownJid?(): string | null;
  now(): number;
  log: Pick<Logger, 'warn' | 'info'>;
}

/** One duplicate chat pair inside one inbox, merged by the startup identity migration. */
export interface PendingMerge {
  inboxId: number;
  /** chat key of the phone-number chat */
  from: string;
  /** chat key of the WhatsApp ID (LID) chat in the same inbox */
  to: string;
}

/**
 * Persisted PN → LID routing (`jid_aliases`) with an in-memory cache. The LID is canonical once
 * known. A pair is a WhatsApp-wide fact about one person, so it is shared by every inbox; routing
 * picks chats only inside the asked inbox. Learning and routing never create, merge or delete
 * chats: existing duplicates are merged only by the startup identity migration.
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

  private hasChat(key: string): boolean {
    return this.db.prepare('SELECT 1 FROM chats WHERE jid = ?').get(key) !== undefined;
  }

  /** True when any inbox has a chat with this WhatsApp JID. */
  private hasAnyChat(waJid: string): boolean {
    return existingChatKeys(this.db, waJid).length > 0;
  }

  /** Sets `phone` on every chat of `waJid` (all inboxes) whose phone matches `where` (any when undefined). */
  private setPhone(waJid: string, phone: string | null, where?: string): void {
    const keys = existingChatKeys(this.db, waJid);
    if (!keys.length) return;
    const list = keys.map(() => '?').join(', ');
    if (where === undefined) {
      this.db.prepare(`UPDATE chats SET phone = ? WHERE jid IN (${list})`).run(phone, ...keys);
    } else {
      this.db
        .prepare(`UPDATE chats SET phone = ? WHERE jid IN (${list}) AND phone = ?`)
        .run(phone, ...keys, where);
    }
  }

  /** The own set read once by the running batch(), else null. */
  private ownCache: Set<string> | null = null;

  /**
   * Runs `fn` with the own numbers read once: contact and history sync learn many pairs, and the
   * own set does not change inside one synchronous batch. Nested batches share the outer set.
   */
  batch<T>(fn: () => T): T {
    if (this.ownCache) return fn();
    this.ownCache = this.ownSet();
    try {
      return fn();
    } finally {
      this.ownCache = null;
    }
  }

  private ownSet(): Set<string> {
    const out = new Set<string>();
    const add = (j: string | null | undefined) => {
      const n = normalizeContactJid(j);
      if (n) out.add(n);
    };
    if (this.opts.ownJids) for (const j of this.opts.ownJids()) add(j);
    add(this.opts.ownJid?.());
    return out;
  }

  /** Canonical identity: the LID for a PN whose LID is known, else `jid` unchanged. */
  resolve(jid: string): string {
    const pn = normalizePn(jid);
    return (pn && this.canonical.get(pn)) || jid;
  }

  /**
   * The chat key a DM JID belongs to now inside `inboxId`: the LID chat when it exists, else an
   * existing (not re-pointed) phone-number chat of the same person — re-keyed to the LID by the next
   * startup — else the LID for a known PN (new chats are LID-keyed), else the JID itself. Never
   * looks at another inbox and never creates or merges anything. The one-argument form takes a
   * chat key (a plain JID is inbox 1's key).
   */
  route(inboxId: number, jid: string): string;
  route(key: string): string;
  route(a: number | string, b?: string): string {
    const parsed = typeof a === 'number' ? { inboxId: a, waJid: b! } : tryParseKey(a);
    // not a chat key we write (e.g. `x#0` from a URL): no chat routes from it
    if (!parsed) return a as string;
    const { inboxId, waJid: jid } = parsed;
    const key = (j: string) => chatKey(inboxId, j);
    const pn = normalizePn(jid);
    const lid = pn ? this.canonical.get(pn) : normalizeLid(jid);
    if (!lid) return key(jid);
    if (this.hasChat(key(lid))) return key(lid);
    const pnChat = this.aliasesOf(lid).find((p) => !this.repointed.has(p) && this.hasChat(key(p)));
    return key(pnChat ?? (pn ? lid : jid));
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
    const own = this.ownCache ?? this.ownSet();
    if (own.has(p.pn) || own.has(p.lid)) return { kind: 'ignored' };
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
        this.setPhone(previous, null, phone);
        // Search also matches contacts.phone: the old person must not come up for the moved number.
        this.db
          .prepare('UPDATE contacts SET phone = NULL WHERE jid = ? AND phone = ?')
          .run(previous, phone);
      }
      // the LID chat of every inbox shows the number
      this.setPhone(p.lid, phone);
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
    if (this.hasAnyChat(p.pn) && this.hasAnyChat(p.lid)) {
      this.opts.log.info(
        { pn: p.pn, lid: p.lid, source },
        'phone-number chat stays separate until the next start merges it',
      );
    }
    return { kind: 'added', ...p };
  }

  /**
   * Aliases whose PN still has its own chat row (and was not re-pointed), per inbox: the PN chat
   * merges into the LID chat of the same inbox at startup, never into another inbox's.
   */
  pendingMerges(): PendingMerge[] {
    const rows = this.db
      .prepare(
        `SELECT c.inbox_id AS inboxId, c.jid AS "from", a.canonical_jid AS lid FROM jid_aliases a
         JOIN chats c ON COALESCE(c.wa_jid, c.jid) = a.alias_jid
         WHERE a.repointed_from IS NULL ORDER BY a.learned_at, a.alias_jid, c.inbox_id`,
      )
      .all() as Array<{ inboxId: number; from: string; lid: string }>;
    return rows.map((r) => ({ inboxId: r.inboxId, from: r.from, to: chatKey(r.inboxId, r.lid) }));
  }
}

export function createAliasStore(ctx: AppContext): AliasStore {
  return new AliasStore(ctx.db, {
    ownJids: () => ctx.inboxes.connections.ownJids(),
    now: Date.now,
    log: ctx.log.child({ mod: 'contacts' }),
  });
}

export function getAliases(ctx: AppContext): AliasStore {
  const s = ctx.services.aliases;
  if (!s) throw new Error('alias store not initialized');
  return s;
}
