import type { FastifyInstance } from 'fastify';
import { ClientErrorBody } from '@wa-team-inbox/shared';
import { SESSION_COOKIE } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { parse } from '../http/errors.js';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
/** The endpoint is public: bound how many client addresses are remembered at once. */
const MAX_TRACKED_IPS = 1000;

interface LimiterOptions {
  windowMs: number;
  maxPerWindow: number;
  maxTracked: number;
  now?: () => number;
}

/** Fixed-window per-IP limiter whose memory stays bounded however many addresses a client rotates through. */
export class ClientErrorLimiter {
  private readonly hits = new Map<string, { start: number; count: number; dropped: number }>();
  private readonly now: () => number;

  constructor(private readonly opts: LimiterOptions) {
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.hits.size;
  }

  /** Counts one report; `droppedInPreviousWindow` is set when this IP's previous window dropped reports. */
  hit(ip: string): { allowed: boolean; droppedInPreviousWindow?: number } {
    const now = this.now();
    let h = this.hits.get(ip);
    let droppedInPreviousWindow: number | undefined;
    if (!h || now - h.start > this.opts.windowMs) {
      if (h?.dropped) droppedInPreviousWindow = h.dropped;
      this.hits.delete(ip);
      this.makeRoom(now);
      h = { start: now, count: 0, dropped: 0 };
      this.hits.set(ip, h);
    }
    const allowed = ++h.count <= this.opts.maxPerWindow;
    if (!allowed) h.dropped++;
    return droppedInPreviousWindow === undefined
      ? { allowed }
      : { allowed, droppedInPreviousWindow };
  }

  private makeRoom(now: number): void {
    if (this.hits.size < this.opts.maxTracked) return;
    for (const [ip, h] of this.hits) if (now - h.start > this.opts.windowMs) this.hits.delete(ip);
    // Still full of live windows: forget the oldest. A new address already starts a fresh window,
    // so eviction gives a rotating client nothing it did not have.
    while (this.hits.size >= this.opts.maxTracked) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
  }
}

/**
 * POST /api/client-errors — browser-side errors (window.onerror, unhandled rejections, React error
 * boundaries) written to the server log as structured `mod: "web"` entries, because render crashes in the
 * PWA are otherwise invisible to the server. Public (errors on the login page matter too) but rate-limited
 * per IP and size-capped by the schema; the global Origin check still applies.
 */
export default async function clientErrorRoutes(app: FastifyInstance, ctx: AppContext) {
  const log = ctx.log.child({ mod: 'web' });
  const limiter = new ClientErrorLimiter({
    windowMs: WINDOW_MS,
    maxPerWindow: MAX_PER_WINDOW,
    maxTracked: MAX_TRACKED_IPS,
  });

  app.post('/client-errors', { bodyLimit: 32 * 1024 }, async (req, reply) => {
    const ip = clientIp(req);
    const { allowed, droppedInPreviousWindow } = limiter.hit(ip);
    if (droppedInPreviousWindow)
      log.warn(
        { ip, dropped: droppedInPreviousWindow },
        'client error reports dropped (rate limit)',
      );
    if (!allowed) return reply.status(204).send();

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
        err: {
          message: body.message,
          stack: body.stack ?? null,
          componentStack: body.componentStack ?? null,
        },
      },
      'client error',
    );
    return reply.status(204).send();
  });
}
