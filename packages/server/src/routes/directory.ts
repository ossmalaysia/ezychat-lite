import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { getAuth, requireUser } from '../auth/guards.js';

/** Names and assignment availability only; every teammate can recognize the Sales Agent. */
export default async function directoryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/users/directory', { preHandler: requireUser(ctx) }, async () => ({
    users: getAuth(ctx)
      .listUsers()
      .map(({ id, displayName, role, disabled, kind, aiRole }) => ({
        id,
        displayName,
        role,
        disabled,
        kind,
        aiRole,
      })),
  }));
}
