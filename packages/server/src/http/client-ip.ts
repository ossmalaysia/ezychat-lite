import type { FastifyRequest } from 'fastify';
import { isIP } from 'node:net';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return LOOPBACK.has(addr) || /^(::ffff:)?127\.\d+\.\d+\.\d+$/.test(addr);
}

/** Unknown public hosts are permitted only on the existing loopback cloudflared trust boundary. */
export function isTrustedTunnelPeer(
  addr: string | undefined,
  cfIp: string | string[] | undefined,
): boolean {
  return isLoopback(addr) && typeof cfIp === 'string' && isIP(cfIp.trim()) !== 0;
}

function peer(req: FastifyRequest): string | undefined {
  return req.socket?.remoteAddress ?? req.raw?.socket?.remoteAddress;
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Real client IP. CF-Connecting-IP is trusted only when the socket peer is loopback (cloudflared). */
export function clientIp(req: FastifyRequest): string {
  const addr = peer(req);
  if (isTrustedTunnelPeer(addr, req.headers['cf-connecting-ip'])) {
    return header(req, 'cf-connecting-ip')!.trim();
  }
  return addr ?? 'unknown';
}

/** True when the original request was HTTPS (directly, or via a loopback proxy/tunnel). */
export function isHttps(req: FastifyRequest): boolean {
  if (req.protocol === 'https') return true;
  if (!isLoopback(peer(req))) return false;
  return (
    header(req, 'x-forwarded-proto') === 'https' ||
    isTrustedTunnelPeer(peer(req), req.headers['cf-connecting-ip'])
  );
}

/** True when the socket peer is loopback AND the request did not arrive through the tunnel. */
export function isDirectLoopback(req: FastifyRequest): boolean {
  return isLoopback(peer(req)) && req.headers['cf-connecting-ip'] === undefined;
}
