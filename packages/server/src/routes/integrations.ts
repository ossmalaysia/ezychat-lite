import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateApiTokenBody, McpSettingsPatch, UpdateApiTokenBody } from '@ezychat/shared';
import { getApiTokens } from '../api-tokens/index.js';
import { requireAdmin, requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { clientIp } from '../http/client-ip.js';
import { errors, parse } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { getMcpOAuth } from '../mcp/oauth.js';
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
 * admins, and so is creating a personal access token. A team member's assistants connect only through
 * the app sign-in (design docs/features/mcp-for-members/design.md); the member lists, changes (Can
 * send) and revokes only their own connected apps here.
 */
export default async function integrationsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireUser(ctx));
  const admin = { preHandler: requireAdmin(ctx) };
  const tokens = getApiTokens(ctx);
  const createLimiter = new WindowLimiter({ windowMs: 60_000, max: 10 });

  app.get('/integrations/mcp', async (req) => mcpSettings(ctx, req.user!));
  app.patch('/integrations/mcp', admin, async (req) => {
    const body = parse(McpSettingsPatch, req.body);
    const userId = req.user!.id;
    const ip = clientIp(req);
    // Members connect only while AI assistant access is on: never armed in advance.
    if (body.membersEnabled === true && !(body.enabled ?? isMcpEnabled(ctx)))
      throw errors.conflict('Turn on AI assistant access first');
    if (body.enabled !== undefined) {
      setMcpEnabled(ctx, body.enabled);
      audit(ctx.db, { userId, action: body.enabled ? 'mcp.enable' : 'mcp.disable', ip });
      // Access off also cancels members' connections (they connect again once it is back on).
      if (!body.enabled && body.membersEnabled === undefined && isMcpMembersEnabled(ctx))
        body.membersEnabled = false;
    }
    if (body.membersEnabled !== undefined) {
      const before = isMcpMembersEnabled(ctx);
      if (before !== body.membersEnabled) {
        setMcpMembersEnabled(ctx, body.membersEnabled);
        // Off: every member's token stops now and is revoked, so turning it on again never
        // reconnects an assistant silently.
        const revoked = body.membersEnabled ? 0 : tokens.revokeMemberTokens();
        // …and so does a code a member approved that the app has not used yet.
        if (!body.membersEnabled) getMcpOAuth(ctx).dropMemberCodes();
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
  // Personal access tokens ("master tokens") are created by admins only; a member's assistant
  // connects through its app sign-in (OAuth) and appears here as a connected app.
  app.post('/integrations/tokens', admin, async (req, reply) => {
    const limited = createLimiter.hit(String(req.user!.id));
    if (!limited.allowed) throw errors.rateLimited(limited.retryAfterSec);
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
