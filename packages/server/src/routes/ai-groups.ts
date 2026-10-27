import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AiAgentGroupsBody, AiGroupChatBody } from '@ezychat/shared';
import { requireAdmin, requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { agentGroups, groupChatStatus, setAgentGroups, setGroupChat } from '../ai/groups.js';
import { clientIp } from '../http/client-ip.js';
import { parse } from '../http/errors.js';
import { chatJidParam } from './chats.js';

const AgentParams = z.object({ agentId: z.coerce.number().int().positive() });

/**
 * AI agents in WhatsApp groups (docs/features/ai-groups/design.md): the agent's "Answer in groups"
 * switch with its inbox's groups (admins), and one group's switch (read: anyone who may open the
 * chat, 404 outside their inboxes; write: admins). Both writes are audited.
 */
export default async function aiGroupRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireUser(ctx));
  const actor = (req: FastifyRequest) => ({ userId: req.user!.id, ip: clientIp(req) });
  const agentId = (req: FastifyRequest) => parse(AgentParams, req.params).agentId;

  app.get('/ai/agents/:agentId/groups', { preHandler: requireAdmin(ctx) }, async (req) =>
    agentGroups(ctx, agentId(req)),
  );
  app.put('/ai/agents/:agentId/groups', { preHandler: requireAdmin(ctx) }, async (req) =>
    setAgentGroups(ctx, agentId(req), parse(AiAgentGroupsBody, req.body).enabled, actor(req)),
  );
  app.get('/chats/:jid/ai-group', async (req) => groupChatStatus(ctx, chatJidParam(ctx, req)));
  app.put('/chats/:jid/ai-group', { preHandler: requireAdmin(ctx) }, async (req) =>
    setGroupChat(ctx, chatJidParam(ctx, req), parse(AiGroupChatBody, req.body).enabled, actor(req)),
  );
}
