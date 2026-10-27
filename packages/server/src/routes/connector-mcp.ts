import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ConnectorAgentSettings, ConnectorConnectBody, ConnectorId } from '@ezychat/shared';
import { requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { getConnectorMcp } from '../connectors/mcp/service.js';
import { OAUTH_CALLBACK_PATH } from '../connectors/mcp/oauth.js';
import { isHostRequest } from '../http/access.js';
import { clientIp } from '../http/client-ip.js';
import { errors, parse } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';

const IdParams = z.object({ id: ConnectorId });
const AgentParams = z.object({ id: ConnectorId, agentId: z.coerce.number().int().positive() });
const RequestParams = z.object({ id: ConnectorId, requestId: z.string().regex(/^[a-f0-9]{32}$/) });
const ChoiceParams = z.object({
  id: ConnectorId,
  settingId: z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/),
});
const TestBody = z.object({ fields: z.record(z.string(), z.string().max(4000)).default({}) });

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A tiny standalone page (no script, no outside resources). */
function sendPage(reply: FastifyReply, status: number, title: string, message: string) {
  return reply
    .status(status)
    .header('cache-control', 'no-store')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
    .type('text/html; charset=utf-8')
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2933}</style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`,
    );
}

/** This server's own callback address, on the port it really listens on. */
function redirectUri(req: FastifyRequest, ctx: AppContext): string {
  const address = req.server.server.address();
  const port = address && typeof address === 'object' ? address.port : ctx.config.port;
  return `http://127.0.0.1:${port}${OAUTH_CALLBACK_PATH}`;
}

/**
 * Partner (MCP) connection routes under `/connectors/mcp/*` (design: connector-list): connect with
 * the entry's sign-in, test, disconnect, per-agent settings, Activity and setting choices (admins),
 * and the partner's OAuth redirect back (this computer only, no session).
 */
export default async function connectorMcpRoutes(app: FastifyInstance, ctx: AppContext) {
  const mcp = getConnectorMcp(ctx);
  const admin = { preHandler: requireAdmin(ctx) };
  const actor = (req: FastifyRequest) => ({ userId: req.user!.id, ip: clientIp(req) });
  // Connect and test reach a partner server: 10 a minute per admin.
  const limiter = new WindowLimiter({ windowMs: 60_000, max: 10 });
  const limit = (req: FastifyRequest) => {
    const result = limiter.hit(String(req.user!.id));
    if (!result.allowed) throw errors.rateLimited(result.retryAfterSec);
  };

  // The partner sends the browser here. Only this computer (the redirect address is 127.0.0.1):
  // never the LAN or the tunnel. The one-time state and the PKCE verifier guard the rest.
  app.get('/connectors/mcp/oauth/callback', async (req, reply) => {
    if (!isHostRequest(req))
      return sendPage(
        reply,
        403,
        'Not allowed',
        'Finish the sign-in on the computer that runs EzyChat.',
      );
    const page = await mcp.callback((req.query ?? {}) as Record<string, unknown>);
    return sendPage(reply, page.status, page.title, page.message);
  });

  app.post('/connectors/mcp/:id/connect', admin, async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(ConnectorConnectBody, req.body ?? {});
    limit(req);
    return mcp.connect(id, body, redirectUri(req, ctx), actor(req));
  });

  app.get('/connectors/mcp/:id/connect/:requestId', admin, async (req) => {
    const { id, requestId } = parse(RequestParams, req.params);
    const progress = mcp.progress(id, requestId);
    if (!progress) throw errors.notFound('Sign-in request');
    return progress;
  });

  app.post('/connectors/mcp/:id/test', admin, async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(TestBody, req.body ?? {});
    limit(req);
    return mcp.test(id, body.fields);
  });

  app.post('/connectors/mcp/:id/disconnect', admin, async (req) => {
    const { id } = parse(IdParams, req.params);
    return mcp.disconnect(id, actor(req));
  });

  app.get('/connectors/mcp/:id/agents/:agentId', admin, async (req) => {
    const { id, agentId } = parse(AgentParams, req.params);
    return mcp.getAgentSettings(id, agentId);
  });

  app.put('/connectors/mcp/:id/agents/:agentId', admin, async (req) => {
    const { id, agentId } = parse(AgentParams, req.params);
    // Unknown connector or agent first (404), then the body (400).
    mcp.getAgentSettings(id, agentId);
    const body = parse(ConnectorAgentSettings, req.body ?? {});
    return mcp.putAgentSettings(id, agentId, body, actor(req));
  });

  app.get('/connectors/mcp/:id/activity', admin, async (req) => {
    const { id } = parse(IdParams, req.params);
    return { activity: mcp.activity(id) };
  });

  app.get('/connectors/mcp/:id/choices/:settingId', admin, async (req) => {
    const { id, settingId } = parse(ChoiceParams, req.params);
    limit(req);
    return mcp.choices(id, settingId);
  });
}
