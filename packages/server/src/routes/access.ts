import type { FastifyInstance } from 'fastify';
import type { AccessStatus } from '@ezychat/shared';
import type { AppContext } from '../context.js';

/** GET /api/access: public; whether the app is usable and, when an edition closed it, the stable code. */
export default async function (app: FastifyInstance, ctx: AppContext) {
  app.get('/access', async (_req, reply): Promise<AccessStatus> => {
    reply.header('cache-control', 'no-store');
    const st = ctx.access.state();
    return st.open ? { open: true } : { open: false, code: st.code };
  });
}
