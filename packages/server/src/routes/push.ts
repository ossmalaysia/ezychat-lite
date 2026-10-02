import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PushSubscribeBody } from '@wa-team-inbox/shared';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { errors, parse } from '../http/errors.js';
import { getPush } from '../push/index.js';
import { isAllowedPushEndpoint } from '../push/service.js';

const UnsubscribeBody = z.object({ endpoint: z.string().min(1) });

export default async function pushRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = { preHandler: requireUser(ctx) };

  app.get('/push/vapid-key', auth, async () => ({ publicKey: getPush(ctx).publicKey() }));

  app.post('/push/subscribe', auth, async (req) => {
    const body = parse(PushSubscribeBody, req.body);
    if (!isAllowedPushEndpoint(body.endpoint)) throw errors.validation('Unsupported push endpoint');
    getPush(ctx).subscribe(req.user!.id, body);
    return { ok: true };
  });

  app.delete('/push/subscribe', auth, async (req) => {
    const body = parse(UnsubscribeBody, req.body);
    getPush(ctx).unsubscribe(req.user!.id, body.endpoint);
    return { ok: true };
  });
}
