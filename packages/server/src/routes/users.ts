import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateUserBody, PatchUserBody } from '@wa-team-inbox/shared';
import { getAuth, requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { clientIp } from '../http/client-ip.js';
import { errors, parse } from '../http/errors.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });

export default async function usersRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = getAuth(ctx);
  app.addHook('preHandler', requireAdmin(ctx));

  app.get('/users', async () => ({ users: auth.listUsers() }));

  app.post('/users', async (req, reply) => {
    const body = parse(CreateUserBody, req.body);
    const user = auth.createUser({ ...body, mustChangePassword: true });
    audit(ctx.db, {
      userId: req.user!.id,
      action: 'user.create',
      ip: clientIp(req),
      meta: { targetId: user.id, username: user.username, role: user.role },
    });
    return reply.status(201).send(user);
  });

  app.patch('/users/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const patch = parse(PatchUserBody, req.body);
    const user = auth.updateUser(id, patch, req.user!.id);
    audit(ctx.db, { userId: req.user!.id, action: 'user.update', ip: clientIp(req), meta: { targetId: id, ...patch } });
    return user;
  });

  app.post('/users/:id/reset-password', async (req) => {
    const { id } = parse(IdParams, req.params);
    if (!auth.getUser(id)) throw errors.notFound('User');
    const password = await auth.resetPassword(id);
    audit(ctx.db, { userId: req.user!.id, action: 'user.reset_password', ip: clientIp(req), meta: { targetId: id } });
    return { password };
  });

  app.delete('/users/:id/sessions', async (req) => {
    const { id } = parse(IdParams, req.params);
    if (!auth.getUser(id)) throw errors.notFound('User');
    auth.revokeAll(id);
    audit(ctx.db, { userId: req.user!.id, action: 'user.revoke_sessions', ip: clientIp(req), meta: { targetId: id } });
    return { ok: true };
  });
}
