import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCode } from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import { isTrustedTunnelPeer } from './client-ip.js';

/**
 * Host-header allowlist (DNS-rebinding defence). A rebinding attacker controls a public domain name,
 * so we accept only Host values such a domain cannot be: loopback names, IP literals (LAN mode),
 * single-label / `.local` LAN machine names, and the current tunnel hostname(s).
 */
export interface HostPolicy {
  /** hostnames currently served through the tunnel (quick URL host, named hostname) */
  tunnelHosts(): string[];
  /** true for a named tunnel whose public hostname is unknown (not configured) */
  allowAnyTunnelHost(): boolean;
}

/** Lower-cased hostname without port / IPv6 brackets; null when empty or malformed. */
export function splitHost(host: string | undefined): string | null {
  if (!host) return null;
  const h = host.trim().toLowerCase();
  if (!h) return null;
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end < 0) return null;
    return h.slice(1, end) || null;
  }
  const colon = h.lastIndexOf(':');
  const name = colon >= 0 ? h.slice(0, colon) : h;
  return name || null;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function isIpLiteral(name: string): boolean {
  return IPV4.test(name) || name.includes(':');
}

/** True when the Host header names this machine via loopback (localhost, 127.x.x.x, ::1), any port. */
export function isLoopbackHost(host: string | undefined): boolean {
  const name = splitHost(host);
  if (!name) return false;
  return name === 'localhost' || name === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

export function hostAllowed(
  host: string | undefined,
  policy: HostPolicy,
  trustedTunnel = false,
): boolean {
  const name = splitHost(host);
  if (!name) return false;
  if (name === 'localhost' || isIpLiteral(name)) return true;
  if (!name.includes('.') || name.endsWith('.local')) return true;
  if (policy.tunnelHosts().some((t) => t.toLowerCase() === name)) return true;
  return trustedTunnel && policy.allowAnyTunnelHost();
}

/** Builds the policy from live tunnel state. */
export function contextHostPolicy(ctx: AppContext): HostPolicy {
  return {
    tunnelHosts() {
      const out: string[] = [];
      const st = ctx.services.tunnel?.status();
      if (st?.url) {
        try {
          out.push(new URL(st.url).hostname);
        } catch {
          // ignore malformed
        }
      }
      if (st?.hostname) out.push(st.hostname);
      const named = ctx.settings.get<string | null>('named_tunnel_hostname', null);
      if (named) out.push(named);
      return out;
    },
    allowAnyTunnelHost() {
      const st = ctx.services.tunnel?.status();
      if (!st || st.mode !== 'named') return false;
      return !ctx.settings.get<string | null>('named_tunnel_hostname', null);
    },
  };
}

export function createHostHook(policy: HostPolicy) {
  return async function hostHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const trustedTunnel = isTrustedTunnelPeer(
      req.socket.remoteAddress,
      req.headers['cf-connecting-ip'],
    );
    if (hostAllowed(req.headers.host, policy, trustedTunnel)) return;
    await reply
      .status(403)
      .type('application/json')
      .send({ error: { code: ErrorCode.BAD_ORIGIN, message: 'Host not allowed' } });
  };
}
