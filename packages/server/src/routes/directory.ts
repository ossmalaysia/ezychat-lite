import type { FastifyInstance } from 'fastify';
import type { DirectoryUser } from '@ezychat/shared';
import type { AppContext } from '../context.js';
import { getAuth, requireUser } from '../auth/guards.js';
import { getInboxService } from '../inboxes/service.js';

/**
 * Names and assignment availability only; every teammate can recognize the Sales Agent.
 * `inboxIds` tells who may open which inbox, so assignment offers only people who can open the chat;
 * an agent sees only the inboxes that agent opens too (other inboxes stay invisible).
 */
export default async function directoryRoutes(app: FastifyInstance, ctx: AppContext) {
  const inboxes = getInboxService(ctx);
  app.get('/users/directory', { preHandler: requireUser(ctx) }, async (req) => ({
    users: getAuth(ctx)
      .listUsers()
      .map((u): DirectoryUser => ({
        id: u.id,
        displayName: u.displayName,
        role: u.role,
        disabled: u.disabled,
        kind: u.kind,
        aiRole: u.aiRole,
        inboxIds: inboxes.directoryInboxIds(u, req.user!),
      })),
  }));
}
