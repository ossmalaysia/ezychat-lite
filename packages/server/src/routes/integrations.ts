import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CreateApiTokenBody, McpSettingsPatch, UpdateApiTokenBody } from '@ezychat/shared';
import { getApiTokens } from '../api-tokens/index.js';
import { requireAdmin, requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { clientIp } from '../http/client-ip.js';
import { HttpError, errors, parse } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';
import {
  isMcpEnabled,
  isMcpMembersEnabled,
  mcpSettings,
  setMcpEnabled,
  setMcpMembersEnabled,
} from '../mcp/settings.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });

/**
 * AI assistant (MCP) access settings and personal access tokens. Cookie session only: a token never
 * authenticates /api, so a token can never create, list or revoke tokens. The settings change is for
 * admins; the token routes also serve a team member for their own tokens (design
 * docs/features/mcp-for-members/design.md): they list, create, change and revoke only their own, and
 * create only while AI assistant access and the members switch are on (checked again by the service).
 */
export default async function integrationsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireUser(ctx));
  const admin = { preHandler: requireAdmin(ctx) };
  const tokens = getApiTokens(ctx);
  const createLimiter = new WindowLimiter({ windowMs: 60_000, max: 10 });

  /** A member may create tokens only while AI assistant access itself is on (admins as before). */
  const ensureMemberMayCreate = (req: FastifyRequest) => {
    if (req.user!.role === 'admin') return;
    if (!isMcpEnabled(ctx) || !isMcpMembersEnabled(ctx))
      throw new HttpError(
        403,
        'mcp_members_off',
        'Your admin has not let members connect AI assistants',
      );
  };

  app.get('/integrations/mcp', async (req) => mcpSettings(ctx, req.user!));
  app.patch('/integrations/mcp', admin, async (req) => {
    const body = parse(McpSettingsPatch, req.body);
    const userId = req.user!.id;
    const ip = clientIp(req);
    if (body.enabled !== undefined) {
      setMcpEnabled(ctx, body.enabled);
      audit(ctx.db, { userId, action: body.enabled ? 'mcp.enable' : 'mcp.disable', ip });
    }
    if (body.membersEnabled !== undefined) {
      const before = isMcpMembersEnabled(ctx);
      if (before !== body.membersEnabled) {
        setMcpMembersEnabled(ctx, body.membersEnabled);
        // Off: every member's token stops now and is revoked, so turning it on again never
        // reconnects an assistant silently.
        const revoked = body.membersEnabled ? 0 : tokens.revokeMemberTokens();
        audit(ctx.db, {
          userId,
          action: 'settings.mcp_members',
          ip,
          meta: { before, after: body.membersEnabled, revokedTokens: revoked },
        });
      }
    }
    return mcpSettings(ctx, req.user!);
  });

  app.get('/integrations/tokens', async (req) => ({ tokens: tokens.list(req.user!) }));
  app.post('/integrations/tokens', async (req, reply) => {
    const limited = createLimiter.hit(String(req.user!.id));
    if (!limited.allowed) throw errors.rateLimited(limited.retryAfterSec);
    ensureMemberMayCreate(req);
    const body = parse(CreateApiTokenBody, req.body);
    reply.header('cache-control', 'no-store').status(201);
    return tokens.create(req.user!.id, body, clientIp(req));
  });
  app.patch('/integrations/tokens/:id', (req) => {
    const limited = createLimiter.hit(String(req.user!.id));
    if (!limited.allowed) throw errors.rateLimited(limited.retryAfterSec);
    const { id } = parse(IdParams, req.params);
    const body = parse(UpdateApiTokenBody, req.body);
    return { token: tokens.updatePermissions(id, req.user!.id, body, clientIp(req)) };
  });
  app.delete('/integrations/tokens/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    // Revoking stays possible for a member while the switch is off (their own tokens only).
    tokens.revoke(id, req.user!, clientIp(req));
    return reply.status(204).send();
  });
}
