import type { FastifyInstance } from 'fastify';
import { CloudflareCreateBody, TunnelStartBody, type TunnelStatus } from '@wa-team-inbox/shared';
import { requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { clientIp } from '../http/client-ip.js';
import { errors, HttpError, parse } from '../http/errors.js';
import type { CloudflareSetupService } from '../tunnel/cloudflare-setup.js';
import type { TunnelService } from '../tunnel/index.js';

function tunnelService(ctx: AppContext): TunnelService {
  const svc = ctx.services.tunnel;
  if (!svc) throw new HttpError(503, 'tunnel_unavailable', 'Tunnel service is not available');
  return svc;
}
function cloudflareService(ctx: AppContext): CloudflareSetupService {
  if (!ctx.services.cloudflareSetup)
    throw new HttpError(503, 'cloudflare_unavailable', 'Cloudflare setup is unavailable');
  return ctx.services.cloudflareSetup;
}
function requireIdle(ctx: AppContext): void {
  if (ctx.services.cloudflareSetup?.status().busy)
    throw errors.conflict('Finish or cancel Cloudflare setup before changing remote access.');
}

export default async function (app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireAdmin(ctx));

  app.get('/tunnel', async (): Promise<TunnelStatus> => tunnelService(ctx).status());

  app.get('/tunnel/cloudflare', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return cloudflareService(ctx).status();
  });
  app.post('/tunnel/cloudflare/login', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const status = await cloudflareService(ctx).login();
    audit(ctx.db, { userId: req.user?.id ?? null, action: 'cloudflare.login', ip: clientIp(req) });
    return status;
  });
  app.post('/tunnel/cloudflare/login/cancel', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return cloudflareService(ctx).cancelLogin();
  });
  app.post('/tunnel/cloudflare/refresh', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return cloudflareService(ctx).refresh();
  });
  app.post('/tunnel/cloudflare/create', async (req) => {
    const body = parse(CloudflareCreateBody, req.body ?? {});
    const status = await cloudflareService(ctx).create(body, req.user?.id ?? 0);
    audit(ctx.db, {
      userId: req.user?.id ?? null,
      action: 'cloudflare.create',
      ip: clientIp(req),
      meta: { domainId: body.domainId, tunnelName: body.tunnelName, subdomain: body.subdomain },
    });
    return status;
  });

  app.post('/tunnel/start', async (req): Promise<TunnelStatus> => {
    requireIdle(ctx);
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
    requireIdle(ctx);
    const status = await tunnelService(ctx).stop(req.user?.id ?? 0);
    audit(ctx.db, { userId: req.user?.id ?? null, action: 'tunnel.stop', ip: clientIp(req) });
    return status;
  });
}
