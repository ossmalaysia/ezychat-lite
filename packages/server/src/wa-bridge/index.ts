import type { WaStatus } from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import { createChatService, type ChatService } from '../chats/service.js';
import { createMessageService, type MessageService } from '../messages/service.js';
import { attachWaBridge } from './bridge.js';

declare module '../context.js' {
  interface Services {
    chats?: ChatService;
    messages?: MessageService;
    /** last WaStatus seen by the bridge (in memory) */
    waStatus?: WaStatus;
    /** detaches the bridge on shutdown */
    waBridge?: { shutdown(): void };
  }
}

export { attachWaBridge } from './bridge.js';
export type { ChatService } from '../chats/service.js';
export type { MessageService } from '../messages/service.js';

/** Service initializer (registered in services.ts): chats + messages services, then the WA bridge. */
export function initMessaging(ctx: AppContext): void {
  ctx.services.chats = createChatService(ctx);
  ctx.services.messages = createMessageService(ctx);
  const detach = attachWaBridge(ctx);
  ctx.services.waBridge = { shutdown: detach };
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
