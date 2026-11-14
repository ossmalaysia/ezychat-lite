import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DreamSettingsBody } from '@ezychat/shared';
import { requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { parse } from '../http/errors.js';
import { dreamAdmin } from '../ai/dream/admin.js';

const AgentParams = z.object({ agentId: z.coerce.number().int().positive() });
const ChangeParams = AgentParams.extend({ id: z.coerce.number().int().positive() });
const HistoryQuery = z.object({ before: z.coerce.number().int().positive().optional() });

/**
 * Dream mode of an AI agent (docs/superpowers/specs/2026-11-14-dream-mode-design.md), admins only: settings, the
 * nightly history, one change with its sources, Apply / Dismiss / Undo.
 */
export default async function dreamRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireAdmin(ctx));
  const dream = dreamAdmin(ctx);
  const actor = (req: FastifyRequest) => ({ userId: req.user!.id, ip: clientIp(req) });
  const agent = (req: FastifyRequest) => parse(AgentParams, req.params).agentId;
  const change = (req: FastifyRequest) => parse(ChangeParams, req.params);

  app.get('/ai/agents/:agentId/dream', async (req) =>
    dream.history(agent(req), parse(HistoryQuery, req.query).before ?? null),
  );
  app.put('/ai/agents/:agentId/dream', async (req) =>
    dream.saveSettings(agent(req), parse(DreamSettingsBody, req.body), actor(req)),
  );
  app.get('/ai/agents/:agentId/dream/changes/:id', async (req) => {
    const { agentId, id } = change(req);
    return dream.detail(agentId, id);
  });
  app.post('/ai/agents/:agentId/dream/changes/:id/apply', async (req) => {
    const { agentId, id } = change(req);
    return dream.apply(agentId, id, actor(req));
  });
  app.post('/ai/agents/:agentId/dream/changes/:id/dismiss', async (req) => {
    const { agentId, id } = change(req);
    return dream.dismiss(agentId, id, actor(req));
  });
  app.post('/ai/agents/:agentId/dream/changes/:id/undo', async (req) => {
    const { agentId, id } = change(req);
    return dream.undo(agentId, id, actor(req));
  });
}
