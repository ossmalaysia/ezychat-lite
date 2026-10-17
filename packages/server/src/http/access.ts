import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCode } from '@ezychat/shared';
import type { AccessGate } from '../access/gate.js';
import { isDirectLoopback } from './client-ip.js';
import { isLoopbackHost } from './host.js';

/** `/api/ext/<name>/host/…`: host-only extension routes (this computer only, no session, open while closed). */
const HOST_ONLY = /^\/api\/ext\/[^/]+\/host(\/|$)/;

/** Routes that answer while the access gate is closed (besides host-only extension routes). */
const OPEN_WHILE_CLOSED = new Set([
  'GET /api/health',
  'HEAD /api/health',
  'GET /api/access',
  'HEAD /api/access',
]);

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * The paths a request may be routed as: the raw path, its decoded form and the matched route
 * pattern. Checking all of them keeps percent-encoded paths (`/%61pi/…`) from slipping past a prefix test.
 */
function requestPaths(req: FastifyRequest): string[] {
  const raw = req.url.split('?')[0] ?? '/';
  const out = [raw, safeDecode(raw)];
  const route = req.routeOptions?.url;
  if (route) out.push(route);
  return out;
}

const isApiPath = (p: string) =>
  p === '/api' || p.startsWith('/api/') || p === '/mcp' || p.startsWith('/mcp/');

export function isHostOnlyPath(path: string): boolean {
  return HOST_ONLY.test(path);
}

/** True when the request comes from this computer directly: loopback peer, loopback Host, no tunnel header. */
export function isHostRequest(req: FastifyRequest): boolean {
  return isDirectLoopback(req) && isLoopbackHost(req.headers.host);
}

/**
 * Host-only convention (onRequest): any route under /api/ext/<name>/host/ answers only a direct
 * loopback client with a loopback Host and no CF-Connecting-IP (same rule as first-admin setup),
 * never the tunnel or the LAN. Such routes need no session and work while the access gate is closed.
 */
export async function hostOnlyHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!requestPaths(req).some(isHostOnlyPath)) return;
  if (isHostRequest(req)) return;
  await reply
    .status(403)
    .type('application/json')
    .send({ error: { code: ErrorCode.FORBIDDEN, message: 'Only allowed from this computer' } });
}

/**
 * Access gate (onRequest): while an edition has closed the gate, every /api and /mcp request answers
 * 403 `{ error: <code> }` except GET /api/health, GET /api/access and host-only extension routes.
 * Static web assets and the SPA page are not affected.
 */
export function createAccessHook(gate: AccessGate) {
  return async function accessHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const st = gate.state();
    if (st.open) return;
    const paths = requestPaths(req);
    if (!paths.some(isApiPath)) return;
    const route = req.routeOptions?.url;
    // Allowlisted only by the matched route (all forms agree), never by a raw prefix alone.
    if (route && paths.every((p) => p === route) && OPEN_WHILE_CLOSED.has(`${req.method} ${route}`))
      return;
    if (route && isHostOnlyPath(route) && isHostRequest(req)) return;
    await reply.status(403).type('application/json').send({ error: st.code });
  };
}
