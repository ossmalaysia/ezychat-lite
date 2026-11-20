import type { FastifyInstance } from 'fastify';
import { OAuthAuthorizeParams, OAuthDecisionBody, type OAuthRequestInfo } from '@ezychat/shared';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { HttpError, errors, parse } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { getMcpOAuth, issuerFor, redirectHost } from '../mcp/oauth.js';
import { isMcpEnabled, mcpHolderRefusal } from '../mcp/settings.js';

/**
 * The approval page of the MCP sign-in (/oauth/authorize in the web app). Cookie session, Origin-checked
 * like every mutating /api route: an app can never approve itself. An admin, or a team member while
 * members may connect AI assistants; the approval is always for the signed-in person only (the code
 * carries their own user id), and a member's app token reaches only what that member can open.
 */
export default async function oauthRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireUser(ctx));
  app.addHook('preHandler', async (req) => {
    const refused = mcpHolderRefusal(ctx, req.user);
    if (refused === 'members_off')
      throw new HttpError(
        403,
        'mcp_members_off',
        'Your admin has not let members connect AI assistants',
      );
    if (refused) throw errors.forbidden('You cannot connect an AI assistant');
  });
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
