import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { getApiTokens, parseBearer, type ApiPrincipal } from '../api-tokens/index.js';
import { audit } from '../db/audit.js';
import { clientIp, isLocalOrTunnel } from '../http/client-ip.js';
import { HttpError, errors } from '../http/errors.js';
import { originHost } from '../http/origin.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { ErrorCode } from '@wa-team-inbox/shared';
import { createInboxReadPort } from './inbox.js';
import { createAiSetupPort } from './ai-setup.js';
import { createMcpServer } from './server.js';
import { MCP_PATH, isMcpEnabled } from './settings.js';
import { handleMcpRequest } from './transport.js';

const unauthorized = () =>
  new HttpError(401, ErrorCode.UNAUTHORIZED, 'A valid access token is required', {
    'www-authenticate': 'Bearer realm="ezychat", error="invalid_token"',
  });

/**
 * POST /mcp: read-only MCP (Streamable HTTP, stateless JSON) for the owner's AI assistant. Outside /api,
 * so the cookie CSRF hook does not apply; it accepts only a personal access token, never a cookie.
 * Order: off → 404 (invisible), LAN peer → 403, Origin check, IP limit, token, token limit.
 */
export async function registerMcp(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(async (scope) => {
    const tokens = getApiTokens(ctx);
    const inbox = createInboxReadPort(ctx);
    const aiSetup = createAiSetupPort(ctx);
    const log = ctx.log.child({ mod: 'mcp' });
    const ipLimiter = new WindowLimiter({ windowMs: 60_000, max: 120 });
    const failureLimiter = new WindowLimiter({ windowMs: 60_000, max: 10 });
    const tokenLimiter = new WindowLimiter({ windowMs: 60_000, max: 60 });
    // One audit row per IP and reason per minute: an unauthenticated caller cannot flood the log.
    const auditLimiter = new WindowLimiter({ windowMs: 60_000, max: 1 });

    const limit = (limiter: WindowLimiter, key: string) => {
      const r = limiter.hit(key);
      if (!r.allowed) throw errors.rateLimited(r.retryAfterSec);
    };

    const authenticate = (req: FastifyRequest): ApiPrincipal => {
      if (!isMcpEnabled(ctx)) throw errors.notFound(`Route ${req.method} ${MCP_PATH}`);
      if (!isLocalOrTunnel(req)) {
        throw errors.forbidden(
          'AI assistant access works only on this computer or through the tunnel',
        );
      }
      // MCP clients send no Origin; a browser page must be same-origin (DNS-rebinding defence).
      const origin = req.headers.origin;
      if (origin !== undefined && originHost(origin) !== (req.headers.host ?? '').toLowerCase()) {
        throw errors.badOrigin();
      }
      const ip = clientIp(req);
      limit(ipLimiter, ip);
      const result = tokens.resolve(parseBearer(req.headers.authorization) ?? '');
      if (!result.ok) {
        limit(failureLimiter, ip);
        if (auditLimiter.hit(`${ip}|${result.reason}`).allowed) {
          audit(ctx.db, {
            userId: null,
            action: 'api_token.auth_failed',
            ip,
            meta: {
              reason: result.reason,
              ...(result.tokenId ? { tokenId: result.tokenId } : {}),
            },
          });
        }
        log.warn({ reason: result.reason, tokenId: result.tokenId }, 'mcp auth failed');
        throw unauthorized();
      }
      limit(tokenLimiter, `token:${result.principal.tokenId}`);
      return result.principal;
    };

    // onRequest runs before body parsing: a disabled endpoint, a LAN peer or a bad token never
    // reaches the parser, so they get 404/403/401 (not 400/413) and always pass the IP limiter.
    const principals = new WeakMap<FastifyRequest, ApiPrincipal>();
    scope.addHook('onRequest', async (req) => {
      principals.set(req, authenticate(req));
    });

    scope.post(MCP_PATH, async (req, reply) => {
      const principal = principals.get(req)!;
      const server = createMcpServer({
        inbox,
        aiSetup,
        principal,
        log,
        stillValid: () => tokens.stillValid(principal.tokenId),
        version: ctx.config.version,
      });
      const res = await handleMcpRequest(req, server);
      return reply
        .status(res.status)
        .headers(res.headers)
        .header('cache-control', 'no-store')
        .send(res.body);
    });

    // Stateless JSON mode has no SSE stream or session to open or delete.
    scope.route({
      method: ['GET', 'DELETE', 'PUT', 'PATCH'],
      url: MCP_PATH,
      handler: async (_req, reply) => {
        return reply
          .status(405)
          .header('allow', 'POST')
          .type('application/json')
          .send({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed' },
            id: null,
          });
      },
    });
  });
}
