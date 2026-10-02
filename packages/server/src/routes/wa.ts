import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WaStatus } from '@wa-team-inbox/shared';
import { requireAdmin, requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { clientIp } from '../http/client-ip.js';

/** Snapshot of the adapter status; the QR string is only revealed to admins. */
export function waStatusFor(status: WaStatus, isAdmin: boolean): WaStatus {
  return { ...status, me: status.me ? { ...status.me } : null, qr: isAdmin ? status.qr : null };
}

/** GET /api/wa/status (any user), POST /api/wa/{logout,relink,takeover} (admin, audited). */
export default async function waRoutes(app: FastifyInstance, ctx: AppContext) {
  const adminOnly = requireAdmin(ctx);
  const record = (req: FastifyRequest, action: string) =>
    audit(ctx.db, {
      userId: req.user?.id ?? null,
      action,
      ip: clientIp(req),
      meta: { state: ctx.wa.status.state },
    });

  app.get('/wa/status', { preHandler: requireUser(ctx) }, async (req) =>
    waStatusFor(ctx.wa.status, req.user?.role === 'admin'),
  );

  app.post('/wa/logout', { preHandler: adminOnly }, async (req) => {
    await ctx.wa.logout();
    record(req, 'wa.logout');
    return waStatusFor(ctx.wa.status, true);
  });

  app.post('/wa/relink', { preHandler: adminOnly }, async (req) => {
    try {
      await ctx.wa.logout();
    } catch (err) {
      // already unlinked / socket closed: still start a fresh link
      ctx.log.warn({ err }, 'wa logout before relink failed');
    }
    await ctx.wa.connect();
    record(req, 'wa.relink');
    return waStatusFor(ctx.wa.status, true);
  });

  app.post('/wa/takeover', { preHandler: adminOnly }, async (req) => {
    await ctx.wa.takeover();
    record(req, 'wa.takeover');
    return waStatusFor(ctx.wa.status, true);
  });
}
