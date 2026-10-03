import type { FastifyInstance } from 'fastify';
import { ClientErrorBody } from '@wa-team-inbox/shared';
import { SESSION_COOKIE } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { parse } from '../http/errors.js';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

/**
 * POST /api/client-errors — browser-side errors (window.onerror, unhandled rejections, React error
 * boundaries) written to the server log as structured `mod: "web"` entries, because render crashes in the
 * PWA are otherwise invisible to the server. Public (errors on the login page matter too) but rate-limited
 * per IP and size-capped by the schema; the global Origin check still applies.
 */
export default async function clientErrorRoutes(app: FastifyInstance, ctx: AppContext) {
  const log = ctx.log.child({ mod: 'web' });
  const hits = new Map<string, { start: number; count: number; dropped: number }>();

  app.post('/client-errors', { bodyLimit: 32 * 1024 }, async (req, reply) => {
    const ip = clientIp(req);
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || now - h.start > WINDOW_MS) {
      if (h?.dropped) log.warn({ ip, dropped: h.dropped }, 'client error reports dropped (rate limit)');
      h = { start: now, count: 0, dropped: 0 };
      hits.set(ip, h);
    }
    if (++h.count > MAX_PER_WINDOW) {
      h.dropped++;
      return reply.status(204).send();
    }

    const body = parse(ClientErrorBody, req.body);
    const token = req.cookies?.[SESSION_COOKIE];
    const user = token ? (ctx.services.auth?.resolveSession(token) ?? null) : null;
    log.error(
      {
        kind: body.kind,
        route: body.route,
        appVersion: body.appVersion,
        userId: user?.id ?? null,
        ip,
        userAgent: req.headers['user-agent'] ?? null,
        err: { message: body.message, stack: body.stack ?? null, componentStack: body.componentStack ?? null },
      },
      'client error',
    );
    return reply.status(204).send();
  });
}
