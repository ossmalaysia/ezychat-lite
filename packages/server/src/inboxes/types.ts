import { EventEmitter } from 'node:events';
import { LINKED_PHONE, type WaStatus } from '@ezychat/shared';
import {
  LINKED_PHONE_CAPABILITIES,
  WaUnavailableError,
  type SendResult,
  type WaAdapter,
  type WaAdapterEvents,
  type WaCapabilities,
  type WaGroupInfo,
} from '@ezychat/wa';
import type { Logger } from 'pino';
import type { AppContext } from '../context.js';
import type { InboxTypeDefinition } from '../extensions.js';
import type { InboxAdapterFactory } from './connections.js';
import { fakeApiInboxType } from './fake-api.js';
import type { InboxRow } from './repo.js';

/** What an adapter can do: its own capabilities, else a linked phone's. */
export function capabilitiesOf(wa: WaAdapter): WaCapabilities {
  return wa.capabilities ?? LINKED_PHONE_CAPABILITIES;
}

/**
 * The inbox types this server can connect besides `linked_phone`, by id: each extension's (the
 * first one wins a duplicate id) and, only with `--mode dev --fake-wa`, the built-in `fake-api`.
 */
export function registeredInboxTypes(
  ctx: Pick<AppContext, 'extensions' | 'config'>,
): Map<string, InboxTypeDefinition> {
  const out = new Map<string, InboxTypeDefinition>();
  for (const ext of ctx.extensions)
    for (const t of ext.inboxTypes ?? []) if (!out.has(t.id)) out.set(t.id, t);
  if (ctx.config.mode === 'dev' && ctx.config.fakeWa && !out.has(fakeApiInboxType.id))
    out.set(fakeApiInboxType.id, fakeApiInboxType);
  return out;
}

/** `linked_phone` or a registered type. */
export function isKnownInboxType(
  ctx: Pick<AppContext, 'extensions' | 'config'>,
  type: string,
): boolean {
  return type === LINKED_PHONE || registeredInboxTypes(ctx).has(type);
}

/**
 * The adapter factory of every inbox: `linked_phone` → `linkedPhone` (Baileys, or the fake);
 * a registered type → its `createAdapter`; a type this build does not have (an Enterprise data
 * dir opened by Lite) → a placeholder that never connects, so the server still starts.
 */
export function createInboxAdapterFactory(opts: {
  linkedPhone: InboxAdapterFactory;
  /** The context (built after the factory; only read when an extension type is created). */
  ctx: () => AppContext;
  log: Logger;
}): InboxAdapterFactory {
  return async (row) => {
    if (row.type === LINKED_PHONE) return opts.linkedPhone(row);
    const ctx = opts.ctx();
    const def = registeredInboxTypes(ctx).get(row.type);
    if (def) return def.createAdapter(ctx, row);
    opts.log.warn({ inboxId: row.id, type: row.type }, 'inbox type not available in this edition');
    return new UnavailableTypeAdapter(row);
  };
}

/** Calls the `detach` of the type an inbox stops using (best effort, logged). */
export async function detachInboxType(
  ctx: AppContext,
  type: string,
  inboxId: number,
): Promise<void> {
  if (type === LINKED_PHONE) return;
  const def = registeredInboxTypes(ctx).get(type);
  if (!def?.detach) return;
  try {
    await def.detach(ctx, inboxId);
  } catch (err) {
    ctx.log.child({ mod: 'inboxes' }).warn({ err, inboxId, type }, 'inbox type detach failed');
  }
}

const NONE: WaCapabilities = Object.freeze({
  qrLink: false,
  history: false,
  groups: false,
  replyWindowHours: null,
  templates: false,
  needsPublicUrl: false,
});

/**
 * The connection of an inbox whose type this build does not have: always logged out with a
 * reason, never sends (WaUnavailableError keeps queued sends pending), never links by QR.
 */
export class UnavailableTypeAdapter extends EventEmitter implements WaAdapter {
  readonly status: WaStatus;
  readonly capabilities = NONE;

  constructor(row: Pick<InboxRow, 'type'>) {
    super();
    this.status = {
      state: 'logged_out',
      me: null,
      qr: null,
      lastError: `inbox type ${row.type} is not available in this edition`,
    };
  }

  override on<K extends keyof WaAdapterEvents>(
    ev: K,
    fn: (...a: WaAdapterEvents[K]) => void,
  ): this {
    return super.on(ev, fn as (...a: unknown[]) => void);
  }

  override off<K extends keyof WaAdapterEvents>(
    ev: K,
    fn: (...a: WaAdapterEvents[K]) => void,
  ): this {
    return super.off(ev, fn as (...a: unknown[]) => void);
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async logout(): Promise<void> {}
  async takeover(): Promise<void> {}
  private unavailable(): Promise<never> {
    return Promise.reject(new WaUnavailableError(this.status.lastError ?? undefined));
  }
  requestPairingCode(): Promise<string> {
    return this.unavailable();
  }
  sendText(): Promise<SendResult> {
    return this.unavailable();
  }
  sendMedia(): Promise<SendResult> {
    return this.unavailable();
  }
  sendReaction(): Promise<SendResult> {
    return this.unavailable();
  }
  async markRead(): Promise<void> {}
  async sendPresence(): Promise<void> {}
  async downloadMedia(): Promise<Buffer | null> {
    return null;
  }
  getProfilePicture(): Promise<string | null> {
    return this.unavailable();
  }
  getGroupInfo(): Promise<WaGroupInfo> {
    return this.unavailable();
  }
  getAbout(): Promise<string | null> {
    return this.unavailable();
  }
  checkNumber(): Promise<string | null> {
    return this.unavailable();
  }
  async getContactAliases(): Promise<[]> {
    return [];
  }
}
