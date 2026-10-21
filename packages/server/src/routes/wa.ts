import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PairingCodeBody, type PairingCodeResponse } from '@ezychat/shared';
import { WaUnavailableError, type WaAdapter } from '@ezychat/wa';
import { errors, parse } from '../http/errors.js';
import { requireAdmin, requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { clientIp } from '../http/client-ip.js';
import { PRIMARY_INBOX_ID } from '../inboxes/keys.js';
import { OFFLINE, waStatusFor } from '../inboxes/service.js';
import { canOpen, scopeFor } from '../inboxes/access.js';

export { waStatusFor };

/** The adapter a WhatsApp action works on, and its inbox for the audit log. */
export type WaTarget = (req: FastifyRequest) => { wa: WaAdapter; inboxId: number };

/**
 * POST `<base>/{logout,relink,takeover,pairing-code}` (admin, audited with `meta.inboxId`):
 * `/wa/*` for inbox 1, `/inboxes/:id/wa/*` for any inbox.
 */
export function registerWaActions(
  app: FastifyInstance,
  ctx: AppContext,
  base: string,
  target: WaTarget,
): void {
  const adminOnly = requireAdmin(ctx);
  const record = (req: FastifyRequest, action: string, wa: WaAdapter, inboxId: number) =>
    audit(ctx.db, {
      userId: req.user?.id ?? null,
      action,
      ip: clientIp(req),
      meta: { state: wa.status.state, inboxId },
    });

  app.post(`${base}/logout`, { preHandler: adminOnly }, async (req) => {
    const { wa, inboxId } = target(req);
    await wa.logout();
    record(req, 'wa.logout', wa, inboxId);
    return waStatusFor(wa.status, true);
  });

  app.post(`${base}/relink`, { preHandler: adminOnly }, async (req) => {
    const { wa, inboxId } = target(req);
    try {
      await wa.logout();
    } catch (err) {
      // already unlinked / socket closed: still start a fresh link
      ctx.log.warn({ err, inboxId }, 'wa logout before relink failed');
    }
    await wa.connect();
    record(req, 'wa.relink', wa, inboxId);
    return waStatusFor(wa.status, true);
  });

  app.post(`${base}/pairing-code`, { preHandler: adminOnly }, async (req) => {
    const { wa, inboxId } = target(req);
    const { phone } = parse(PairingCodeBody, req.body);
    let code: string;
    try {
      code = await wa.requestPairingCode(phone);
    } catch (err) {
      if (err instanceof WaUnavailableError) throw errors.waUnavailable();
      throw errors.validation((err as Error).message);
    }
    record(req, 'wa.pairing_code', wa, inboxId);
    return { code } satisfies PairingCodeResponse;
  });

  app.post(`${base}/takeover`, { preHandler: adminOnly }, async (req) => {
    const { wa, inboxId } = target(req);
    await wa.takeover();
    record(req, 'wa.takeover', wa, inboxId);
    return waStatusFor(wa.status, true);
  });
}

/**
 * GET /api/wa/status (any user; a neutral offline status for a user who cannot open inbox 1, so
 * its number and state never leak), POST /api/wa/{logout,relink,takeover} (admin, audited): inbox 1.
 */
export default async function waRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/wa/status', { preHandler: requireUser(ctx) }, async (req) => {
    const user = req.user!;
    if (!canOpen(scopeFor(ctx, user), PRIMARY_INBOX_ID)) return { ...OFFLINE };
    return waStatusFor(ctx.wa.status, user.role === 'admin');
  });
  registerWaActions(app, ctx, '/wa', () => ({ wa: ctx.wa, inboxId: PRIMARY_INBOX_ID }));
}
