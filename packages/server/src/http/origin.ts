import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCode } from '@wa-team-inbox/shared';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * CSRF guard (onRequest hook). For mutating /api requests the Origin host must equal the Host header.
 * Requests with neither Origin nor Cookie are allowed (CLI/tests); cookie without Origin → 403.
 */
export async function originHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (SAFE.has(req.method)) return;
  const path = req.url.split('?')[0] ?? '';
  if (path !== '/api' && !path.startsWith('/api/')) return;
  const origin = req.headers.origin;
  const host = (req.headers.host ?? '').toLowerCase();
  if (!origin) {
    if (!req.headers.cookie) return;
  } else if (origin !== 'null' && originHost(origin) === host && host !== '') {
    return;
  }
  await reply
    .status(403)
    .type('application/json')
    .send({ error: { code: ErrorCode.BAD_ORIGIN, message: 'Origin does not match host' } });
}
