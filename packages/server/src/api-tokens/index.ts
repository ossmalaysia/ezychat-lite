import type { AppContext } from '../context.js';
import { createApiTokenService, type ApiTokenService } from './service.js';

declare module '../context.js' {
  interface Services {
    apiTokens?: ApiTokenService;
  }
}

export { createApiTokenService, parseBearer, TOKEN_PREFIX } from './service.js';
export type { ApiPrincipal, ApiTokenService, ResolveFailure, TokenScope } from './service.js';

/** Service initializer (registered in services.ts, after initAuth). */
export function initApiTokens(ctx: AppContext): void {
  ctx.services.apiTokens = createApiTokenService(ctx);
}

export function getApiTokens(ctx: AppContext): ApiTokenService {
  const s = ctx.services.apiTokens;
  if (!s) throw new Error('api token service not initialized');
  return s;
}
