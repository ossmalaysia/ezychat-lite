import type { AppContext } from '../context.js';
import { createPushService, type PushService } from './service.js';

declare module '../context.js' {
  interface Services {
    push?: PushService;
  }
}

export { createPushService } from './service.js';
export type { PushService, PushSender, PushDeps } from './service.js';
export { loadOrCreateVapid, DEFAULT_PUSH_SUBJECT } from './vapid.js';
export type { VapidDetails } from './vapid.js';

/** Service initializer (registered in services.ts). */
export function initPush(ctx: AppContext): void {
  ctx.services.push = createPushService(ctx);
}

export function getPush(ctx: AppContext): PushService {
  const s = ctx.services.push;
  if (!s) throw new Error('push service not initialized');
  return s;
}
