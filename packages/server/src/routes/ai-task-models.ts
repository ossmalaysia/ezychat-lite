import type { FastifyInstance } from 'fastify';
import { AiTaskModelsBody } from '@ezychat/shared';
import { requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { errors, parse } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';

/**
 * Settings → AI → AI models (docs/ai-models.md): which model each AI job uses, per connection. Admins only;
 * a save changes only the current connection's rows, 30 saves a minute per admin.
 */
export default async function aiTaskModelRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireAdmin(ctx));
  const ai = ctx.services.ai!;
  const limiter = new WindowLimiter({ windowMs: 60_000, max: 30 });
  app.get('/ai/task-models', async () => ai.taskModels());
  app.put('/ai/task-models', async (req) => {
    const result = limiter.hit(String(req.user!.id));
    if (!result.allowed) throw errors.rateLimited(result.retryAfterSec);
    const body = parse(AiTaskModelsBody, req.body);
    return ai.setTaskModels(body, { userId: req.user!.id, ip: clientIp(req) });
  });
}
