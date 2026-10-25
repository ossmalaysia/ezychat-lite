import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCode } from '@ezychat/shared';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function originHost(origin: string): string | null {
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
  return checkOrigin(req, reply, null);
}

/** `/api/ext/<name>/public` and everything below it. */
export function publicRoutesPrefix(extensionName: string): string {
  return `/api/ext/${extensionName}/public`;
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * The CSRF guard of the app: `originHook`, except for the public (signature-checked) routes of the
 * extensions named here, which a third party calls with no Origin (a webhook). Only the exact
 * prefix of an extension that declares `publicRoutes` is skipped: the raw path and the matched
 * route must both be under it, so an encoded path never slips past.
 */
export function createOriginHook(publicExtensions: readonly string[]) {
  const prefixes = publicExtensions.map(publicRoutesPrefix);
  const isPublic = (req: FastifyRequest): boolean => {
    if (!prefixes.length) return false;
    const raw = req.url.split('?')[0] ?? '';
    const route = req.routeOptions?.url;
    return prefixes.some((p) => under(raw, p) && route !== undefined && under(route, p));
  };
  return async function originHookWithPublic(req: FastifyRequest, reply: FastifyReply) {
    return checkOrigin(req, reply, isPublic);
  };
}

async function checkOrigin(
  req: FastifyRequest,
  reply: FastifyReply,
  isPublic: ((req: FastifyRequest) => boolean) | null,
): Promise<void> {
  if (SAFE.has(req.method)) return;
  const path = req.url.split('?')[0] ?? '';
  if (path !== '/api' && !path.startsWith('/api/')) return;
  if (isPublic?.(req)) return;
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
