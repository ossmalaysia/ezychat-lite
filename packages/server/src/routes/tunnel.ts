import type { FastifyInstance } from 'fastify';
import { TunnelStartBody, type TunnelStatus } from '@wa-team-inbox/shared';
import { requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { clientIp } from '../http/client-ip.js';
import { HttpError, parse } from '../http/errors.js';
import type { TunnelService } from '../tunnel/index.js';

function tunnelService(ctx: AppContext): TunnelService {
  const svc = ctx.services.tunnel;
  if (!svc) throw new HttpError(503, 'tunnel_unavailable', 'Tunnel service is not available');
  return svc;
}

export default async function (app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireAdmin(ctx));

  app.get('/tunnel', async (): Promise<TunnelStatus> => tunnelService(ctx).status());

  app.post('/tunnel/start', async (req): Promise<TunnelStatus> => {
    const body = parse(TunnelStartBody, req.body ?? {});
    const actorId = req.user?.id ?? 0;
    const status = await tunnelService(ctx).start(body, actorId);
    audit(ctx.db, {
      userId: req.user?.id ?? null,
      action: 'tunnel.start',
      ip: clientIp(req),
      meta: { mode: body.mode, hostname: body.hostname ?? null, tokenChanged: Boolean(body.token) },
    });
    return status;
  });

  app.post('/tunnel/stop', async (req): Promise<TunnelStatus> => {
    const status = await tunnelService(ctx).stop(req.user?.id ?? 0);
    audit(ctx.db, { userId: req.user?.id ?? null, action: 'tunnel.stop', ip: clientIp(req) });
    return status;
  });
}
