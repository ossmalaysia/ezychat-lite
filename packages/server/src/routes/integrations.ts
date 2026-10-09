import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateApiTokenBody, McpSettingsPatch } from '@wa-team-inbox/shared';
import { getApiTokens } from '../api-tokens/index.js';
import { requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { clientIp } from '../http/client-ip.js';
import { errors, parse } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { mcpSettings, setMcpEnabled } from '../mcp/settings.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });

/**
 * AI assistant (MCP) access settings and personal access tokens. Cookie session + admin only: a token
 * never authenticates /api, so a token can never create, list or revoke tokens.
 */
export default async function integrationsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireAdmin(ctx));
  const tokens = getApiTokens(ctx);
  const createLimiter = new WindowLimiter({ windowMs: 60_000, max: 10 });

  app.get('/integrations/mcp', async () => mcpSettings(ctx));
  app.patch('/integrations/mcp', async (req) => {
    const { enabled } = parse(McpSettingsPatch, req.body);
    setMcpEnabled(ctx, enabled);
    audit(ctx.db, {
      userId: req.user!.id,
      action: enabled ? 'mcp.enable' : 'mcp.disable',
      ip: clientIp(req),
    });
    return mcpSettings(ctx);
  });

  app.get('/integrations/tokens', async () => ({ tokens: tokens.list() }));
  app.post('/integrations/tokens', async (req, reply) => {
    const limited = createLimiter.hit(String(req.user!.id));
    if (!limited.allowed) throw errors.rateLimited(limited.retryAfterSec);
    const body = parse(CreateApiTokenBody, req.body);
    reply.header('cache-control', 'no-store').status(201);
    return tokens.create(req.user!.id, body, clientIp(req));
  });
  app.delete('/integrations/tokens/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    tokens.revoke(id, req.user!.id, clientIp(req));
    return reply.status(204).send();
  });
}
