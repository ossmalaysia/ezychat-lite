import type { FastifyInstance } from 'fastify';
import { OAuthAuthorizeParams, OAuthDecisionBody, type OAuthRequestInfo } from '@ezychat/shared';
import { requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { errors, parse } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { getMcpOAuth, issuerFor, redirectHost } from '../mcp/oauth.js';
import { isMcpEnabled } from '../mcp/settings.js';

/**
 * The approval page of the MCP sign-in (/oauth/authorize in the web app). Cookie session + admin
 * only, Origin-checked like every mutating /api route: an app can never approve itself.
 */
export default async function oauthRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireAdmin(ctx));
  const oauth = getMcpOAuth(ctx);
  const decisionLimiter = new WindowLimiter({ windowMs: 60_000, max: 20 });

  const ensureEnabled = () => {
    if (!isMcpEnabled(ctx)) {
      throw errors.conflict('AI assistant access is off. Turn it on in Settings → Integrations.');
    }
  };

  app.get('/oauth/request', async (req): Promise<OAuthRequestInfo> => {
    ensureEnabled();
    const params = parse(OAuthAuthorizeParams, req.query);
    const { client, redirectUri } = oauth.check(params, issuerFor(req));
    return { clientName: client.name, redirectHost: redirectHost(redirectUri) };
  });

  app.post('/oauth/decision', async (req, reply) => {
    const limited = decisionLimiter.hit(String(req.user!.id));
    if (!limited.allowed) throw errors.rateLimited(limited.retryAfterSec);
    ensureEnabled();
    const { approve, ...params } = parse(OAuthDecisionBody, req.body);
    reply.header('cache-control', 'no-store');
    return {
      redirectTo: oauth.decide(params, issuerFor(req), req.user!, approve, clientIp(req)),
    };
  });
}
