import type { WaStatus } from '@ezychat/shared';
import type { WaAdapter } from '@ezychat/wa';
import type { AppContext } from '../context.js';
import { createAliasStore } from '../chats/aliases.js';
import { runIdentityMigration } from '../chats/identity-migration.js';
import { createChatService, type ChatService } from '../chats/service.js';
import { createMessageService, type MessageService } from '../messages/service.js';
import { attachWaBridge } from './bridge.js';

declare module '../context.js' {
  interface Services {
    chats?: ChatService;
    messages?: MessageService;
    /** last WaStatus of inbox 1 seen by the bridge (in memory); per inbox: connections.statuses() */
    waStatus?: WaStatus;
    /** detaches the bridge of every inbox on shutdown */
    waBridge?: { shutdown(): void };
  }
}

export { attachWaBridge } from './bridge.js';
export type { ChatService } from '../chats/service.js';
export type { MessageService } from '../messages/service.js';

/**
 * Service initializer (registered in services.ts, before initPush/initAi; runInitializers finishes
 * before HTTP listen and wa.connect()). The startup identity migration — the only place chats are
 * merged — runs before the message service restores pending sends and before the AI Sales Agent.
 */
export function initMessaging(ctx: AppContext): void {
  ctx.services.aliases = createAliasStore(ctx);
  runIdentityMigration(ctx);
  ctx.services.chats = createChatService(ctx);
  ctx.services.messages = createMessageService(ctx);
  ctx.services.waBridge = attachInboxBridges(ctx);
}

/**
 * One bridge per inbox: the inboxes connected at start, then every inbox added later; a removed
 * inbox's bridge is detached (the message service stops its queue on the same event).
 */
function attachInboxBridges(ctx: AppContext): { shutdown(): void } {
  const { connections } = ctx.inboxes;
  const detachers = new Map<number, () => void>();
  const attach = (inboxId: number, wa: WaAdapter) => {
    detachers.get(inboxId)?.();
    detachers.set(inboxId, attachWaBridge(ctx, inboxId, wa));
  };
  const onAdded = (inboxId: number, wa: WaAdapter) => attach(inboxId, wa);
  const onRemoved = (inboxId: number) => {
    detachers.get(inboxId)?.();
    detachers.delete(inboxId);
  };
  for (const [inboxId, wa] of connections.entries()) attach(inboxId, wa);
  connections.on('added', onAdded);
  connections.on('removed', onRemoved);
  return {
    shutdown() {
      connections.off('added', onAdded);
      connections.off('removed', onRemoved);
      for (const detach of detachers.values()) detach();
      detachers.clear();
    },
  };
}

export function getChats(ctx: AppContext): ChatService {
  const s = ctx.services.chats;
  if (!s) throw new Error('chats service not initialized');
  return s;
}

export function getMessages(ctx: AppContext): MessageService {
  const s = ctx.services.messages;
  if (!s) throw new Error('messages service not initialized');
  return s;
}
