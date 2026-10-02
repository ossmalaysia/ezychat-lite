import type { AppContext } from '../context.js';
import { createAuthService, type AuthService } from './service.js';

declare module '../context.js' {
  interface Services {
    auth?: AuthService;
  }
}

export { createAuthService, rowToUser, SESSION_IDLE_MS } from './service.js';
export type { AuthService, CreateUserInput } from './service.js';
export {
  requireUser,
  requireAdmin,
  loadUser,
  getAuth,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
} from './guards.js';
export { LoginRateLimiter } from './rate-limit.js';
export { resetFirstAdmin } from './reset.js';

/** Service initializer (registered in services.ts). */
export function initAuth(ctx: AppContext): void {
  ctx.services.auth = createAuthService(ctx);
}
