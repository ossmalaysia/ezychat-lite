import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { clientIp, isLocalOrTunnel } from '../http/client-ip.js';
import { errors } from '../http/errors.js';
import { rateLimitKey } from '../http/rate-limit-key.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { OAuthError, REGISTER_PATH, TOKEN_PATH, getMcpOAuth, issuerFor } from './oauth.js';
import { MCP_PATH, isMcpEnabled } from './settings.js';

export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
export const AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server';

/** Where an MCP client finds how to sign in (sent in the 401 of /mcp, RFC 9728). */
export function resourceMetadataUrl(req: FastifyRequest): string {
  return `${issuerFor(req)}${PROTECTED_RESOURCE_PATH}${MCP_PATH}`;
}

/**
 * The app-facing half of the MCP sign-in: discovery metadata, app registration and the token
 * endpoint. Same reach as /mcp: off → 404, LAN peer → 403 (only this computer or the tunnel).
 * The approval page and its API (/api/oauth/*) need a signed-in admin.
 */
export async function registerMcpOAuth(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(async (scope) => {
    const oauth = getMcpOAuth(ctx);
    const registerLimiter = new WindowLimiter({ windowMs: 60_000, max: 10 });
    const tokenLimiter = new WindowLimiter({ windowMs: 60_000, max: 30 });

    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string', bodyLimit: 16 * 1024 },
      (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
    );

    scope.addHook('onRequest', async (req) => {
      if (!isMcpEnabled(ctx)) throw errors.notFound(`Route ${req.method} ${req.url.split('?')[0]}`);
      if (!isLocalOrTunnel(req)) {
        throw errors.forbidden(
          'AI assistant access works only on this computer or through the tunnel',
        );
      }
    });

    const limit = (limiter: WindowLimiter, req: FastifyRequest) => {
      const r = limiter.hit(rateLimitKey(clientIp(req)));
      if (!r.allowed) throw errors.rateLimited(r.retryAfterSec);
    };
    const sendOAuth = (reply: FastifyReply, status: number, body: unknown) =>
      reply
        .status(status)
        .header('cache-control', 'no-store')
        .header('pragma', 'no-cache')
        .send(body);

    const resource = async (req: FastifyRequest) => oauth.protectedResourceMetadata(issuerFor(req));
    scope.get(PROTECTED_RESOURCE_PATH, resource);
    scope.get(`${PROTECTED_RESOURCE_PATH}${MCP_PATH}`, resource);
    scope.get(AUTHORIZATION_SERVER_PATH, async (req) =>
      oauth.authorizationServerMetadata(issuerFor(req)),
    );

    scope.post(REGISTER_PATH, async (req, reply) => {
      limit(registerLimiter, req);
      try {
        return sendOAuth(reply, 201, oauth.register(req.body));
      } catch (err) {
        if (err instanceof OAuthError) return sendOAuth(reply, err.status, err.body());
        throw err;
      }
    });

    scope.post(TOKEN_PATH, async (req, reply) => {
      limit(tokenLimiter, req);
      const raw = (req.body ?? {}) as Record<string, unknown>;
      const form = Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]),
      );
      try {
        return sendOAuth(
          reply,
          200,
          oauth.exchange(form, req.headers.authorization, issuerFor(req), clientIp(req)),
        );
      } catch (err) {
        if (err instanceof OAuthError) {
          if (err.status === 401) reply.header('www-authenticate', 'Basic realm="ezychat"');
          return sendOAuth(reply, err.status, err.body());
        }
        throw err;
      }
    });
  });
}
