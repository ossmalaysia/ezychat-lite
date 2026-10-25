import { EventEmitter } from 'node:events';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LINKED_PHONE, type WaStatus } from '@ezychat/shared';
import { FakeWaAdapter, type WaAdapter, type WaAdapterOptions } from '@ezychat/wa';
import type { Logger } from 'pino';
import { PRIMARY_INBOX_ID, inboxOfKey } from './keys.js';
import { inboxAuthDir, type InboxRepo, type InboxRow } from './repo.js';

/** Builds the WhatsApp adapter of one inbox. */
export type InboxAdapterFactory = (row: InboxRow) => Promise<WaAdapter>;

/** Loads the Baileys adapter lazily (keeps baileys out of tests / --fake-wa runs). */
export async function createRealWaAdapter(opts: WaAdapterOptions): Promise<WaAdapter> {
  const mod = (await import('@ezychat/wa')) as Record<string, unknown>;
  const create = mod.createBaileysAdapter as ((o: WaAdapterOptions) => WaAdapter) | undefined;
  if (typeof create !== 'function')
    throw new Error('createBaileysAdapter is not available in @ezychat/wa');
  return create(opts);
}

/**
 * The adapter of each inbox: a fake one with --fake-wa (inbox 1 keeps today's fake identity,
 * others get their own number and message id prefix), else Baileys on the inbox's own folder.
 */
export function defaultAdapterFactory(opts: {
  dataDir: string;
  fakeWa: boolean;
  historyDays: number | (() => number);
  log: Logger;
  /** Dev runs with --max-inboxes: a fake phone that was never linked waits for its QR scan. */
  fakeScan?: boolean;
}): InboxAdapterFactory {
  return async (row) => {
    if (opts.fakeWa) {
      if (row.id === PRIMARY_INBOX_ID) return new FakeWaAdapter();
      return new FakeWaAdapter({
        me: { jid: `6000000000${row.id}@s.whatsapp.net`, name: row.name },
        idPrefix: `FAKE${row.id}`,
        awaitScan: opts.fakeScan === true && row.own_jid === null,
      });
    }
    return createRealWaAdapter({
      authDir: join(opts.dataDir, row.auth_dir),
      historyDays: opts.historyDays,
      logger:
        row.id === PRIMARY_INBOX_ID
          ? opts.log.child({ mod: 'wa' })
          : opts.log.child({ mod: 'wa', inboxId: row.id }),
    });
  };
}

interface ConnectionEvents {
  added: [inboxId: number, wa: WaAdapter];
  /** `replaced`: the inbox stays and an `added` with its new adapter follows (a type change). */
  removed: [inboxId: number, wa: WaAdapter, reason: 'removed' | 'replaced'];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Registry of the WhatsApp connection of every active inbox: one adapter each. Inbox 1 is always
 * present. `added` fires before a new adapter connects (attach listeners there); adapters that
 * exist at start are read with `entries()`.
 */
export class InboxConnections {
  private readonly adapters = new Map<number, WaAdapter>();
  private readonly events = new EventEmitter();
  private readonly repo: InboxRepo;
  private readonly log: Logger;
  private readonly limit: number;
  private readonly staggerMs: number;
  private readonly create: InboxAdapterFactory;
  private readonly overrides: Readonly<Record<number, WaAdapter>>;
  private readonly dataDir: string | null;
  private readonly detachType: (type: string, inboxId: number) => Promise<void>;
  private started = false;
  private stopped = false;

  constructor(opts: {
    repo: InboxRepo;
    /** Most inboxes this build may have (Lite 1). */
    maxInboxes: number;
    log: Logger;
    /** The adapter of inbox 1; built by `create` in init() when absent. */
    primary?: WaAdapter;
    create: InboxAdapterFactory;
    /** Adapters to use instead of `create` for these inbox ids (tests, other editions). */
    adapters?: Readonly<Record<number, WaAdapter>>;
    /** Data dir; a removed inbox's own folder in it is deleted. */
    dataDir?: string;
    /** Pause between two inboxes in connectAll (default 500 ms). */
    staggerMs?: number;
    /** The inbox stops using a type other than linked_phone (removed or switched): its `detach`. */
    detachType?: (type: string, inboxId: number) => Promise<void>;
  }) {
    if (!Number.isInteger(opts.maxInboxes) || opts.maxInboxes < 1)
      throw new Error(`invalid maxInboxes: ${opts.maxInboxes}`);
    this.repo = opts.repo;
    this.log = opts.log;
    this.limit = opts.maxInboxes;
    this.staggerMs = opts.staggerMs ?? 500;
    this.create = opts.create;
    this.overrides = opts.adapters ?? {};
    this.dataDir = opts.dataDir ?? null;
    this.detachType = opts.detachType ?? (async () => undefined);
    if (opts.primary) this.adapters.set(PRIMARY_INBOX_ID, opts.primary);
  }

  /**
   * Creates the adapters of the active inboxes (does not connect them), inbox 1 first unless it was
   * given, at most maxInboxes in all: rows beyond the limit (a data dir from a bigger build) get no
   * connection.
   */
  async init(): Promise<void> {
    if (!this.adapters.has(PRIMARY_INBOX_ID)) {
      const primary = this.repo.get(PRIMARY_INBOX_ID);
      if (!primary) throw new Error('inbox 1 is missing');
      this.adapters.set(PRIMARY_INBOX_ID, await this.build(primary));
    }
    const skipped: number[] = [];
    for (const row of this.repo.active()) {
      if (this.adapters.has(row.id)) continue;
      if (this.adapters.size >= this.limit) {
        skipped.push(row.id);
        continue;
      }
      this.adapters.set(row.id, await this.build(row));
    }
    if (skipped.length > 0)
      this.log.warn(
        { inboxIds: skipped, maxInboxes: this.limit },
        'inboxes over the limit not connected',
      );
  }

  maxInboxes(): number {
    return this.limit;
  }

  /** The adapter of an active inbox; throws for an unknown or removed one. */
  adapter(inboxId: number): WaAdapter {
    const wa = this.adapters.get(inboxId);
    if (!wa) throw new Error(`inbox ${inboxId} has no WhatsApp connection`);
    return wa;
  }

  /** The adapter of the inbox a chat key (or message key) belongs to. */
  forChatKey(key: string): WaAdapter {
    return this.adapter(inboxOfKey(key));
  }

  /** [inboxId, adapter] of every active inbox, by id. */
  entries(): Array<[number, WaAdapter]> {
    return [...this.adapters.entries()].sort((a, b) => a[0] - b[0]);
  }

  statuses(): Map<number, WaStatus> {
    return new Map(this.entries().map(([id, wa]) => [id, wa.status]));
  }

  /** Own JIDs (and LIDs) of every inbox, linked now or before; never a customer. */
  ownJids(): Set<string> {
    const out = new Set<string>();
    for (const [, wa] of this.entries()) {
      const me = wa.status.me;
      if (me?.jid) out.add(me.jid);
      if (me?.lid) out.add(me.lid);
    }
    for (const row of this.repo.list()) if (row.own_jid) out.add(row.own_jid);
    return out;
  }

  /** Adds the adapter of a new inbox; it connects at once when the server already started. */
  async add(row: InboxRow): Promise<WaAdapter> {
    if (this.adapters.has(row.id)) throw new Error(`inbox ${row.id} is already connected`);
    const wa = await this.build(row);
    this.adapters.set(row.id, wa);
    this.emit('added', row.id, wa);
    if (this.started && !this.stopped) await this.connectOne(row.id, wa);
    return wa;
  }

  /**
   * Unlinks an inbox's phone (logout wipes its session) or, for another type, disconnects it and
   * calls the type's detach; drops its adapter and deletes its own folder under wa-auth-inboxes/.
   * Never touches wa-auth/: inbox 1 cannot be removed. The caller marks the row removed.
   */
  async remove(inboxId: number): Promise<void> {
    if (inboxId === PRIMARY_INBOX_ID) throw new Error('primary_inbox');
    const wa = this.adapters.get(inboxId);
    if (!wa) return;
    this.adapters.delete(inboxId);
    const row = this.repo.get(inboxId);
    await this.release(inboxId, wa, row?.type ?? LINKED_PHONE);
    if (this.dataDir && row && row.auth_dir === inboxAuthDir(inboxId))
      await rm(join(this.dataDir, row.auth_dir), { recursive: true, force: true });
    this.emit('removed', inboxId, wa, 'removed');
  }

  /**
   * The inbox's type changed (its row already says the new one): builds the new adapter first (a
   * failure changes nothing), then lets go of the old one (`logout()` for a linked phone, which
   * wipes its auth folder, `wa-auth/` for inbox 1, as an unlink does; else `disconnect()` and the
   * old type's detach), emits `removed` ('replaced') then `added`, and connects the new adapter when
   * the server already started. Chats, keys and queued sends stay with the inbox.
   */
  async replace(inboxId: number, fromType: string): Promise<WaAdapter> {
    const old = this.adapters.get(inboxId);
    const row = this.repo.get(inboxId);
    if (!old || !row) throw new Error(`inbox ${inboxId} has no WhatsApp connection`);
    const wa = await this.create(row);
    this.adapters.delete(inboxId);
    await this.release(inboxId, old, fromType);
    this.emit('removed', inboxId, old, 'replaced');
    this.adapters.set(inboxId, wa);
    this.emit('added', inboxId, wa);
    if (this.started && !this.stopped) await this.connectOne(inboxId, wa);
    return wa;
  }

  /** Lets go of an adapter the inbox no longer uses (best effort, logged). */
  private async release(inboxId: number, wa: WaAdapter, type: string): Promise<void> {
    if (type === LINKED_PHONE) {
      try {
        await wa.logout();
      } catch (err) {
        this.log.warn({ err, inboxId }, 'wa logout failed');
        await wa.disconnect().catch(() => undefined);
      }
      return;
    }
    await wa.disconnect().catch((err: unknown) => {
      this.log.warn({ err, inboxId }, 'wa disconnect failed');
    });
    await this.detachType(type, inboxId);
  }

  /** Connects every inbox, one after another (staggerMs apart); stops when disconnectAll runs. */
  async connectAll(): Promise<void> {
    this.started = true;
    this.stopped = false;
    const ids = this.entries().map(([id]) => id);
    for (const [i, id] of ids.entries()) {
      if (i > 0 && this.staggerMs > 0) await sleep(this.staggerMs);
      if (this.stopped) return;
      const wa = this.adapters.get(id);
      if (wa) await this.connectOne(id, wa);
    }
  }

  async disconnectAll(): Promise<void> {
    this.stopped = true;
    this.started = false;
    const all = this.entries();
    const results = await Promise.allSettled(all.map(([, wa]) => wa.disconnect()));
    results.forEach((r, i) => {
      if (r.status === 'rejected')
        this.log.warn({ err: r.reason, inboxId: all[i]![0] }, 'wa disconnect failed');
    });
  }

  on<K extends keyof ConnectionEvents>(ev: K, fn: (...a: ConnectionEvents[K]) => void): this {
    this.events.on(ev, fn as (...a: unknown[]) => void);
    return this;
  }

  off<K extends keyof ConnectionEvents>(ev: K, fn: (...a: ConnectionEvents[K]) => void): this {
    this.events.off(ev, fn as (...a: unknown[]) => void);
    return this;
  }

  private emit<K extends keyof ConnectionEvents>(ev: K, ...a: ConnectionEvents[K]): void {
    this.events.emit(ev, ...a);
  }

  private build(row: InboxRow): Promise<WaAdapter> {
    const given = this.overrides[row.id];
    return given ? Promise.resolve(given) : this.create(row);
  }

  private async connectOne(inboxId: number, wa: WaAdapter): Promise<void> {
    try {
      await wa.connect();
    } catch (err) {
      this.log.error({ err, inboxId }, 'wa connect failed');
    }
  }
}
