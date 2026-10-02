const QUICK_URL_RE = /https:\/\/([a-z0-9]+(?:-[a-z0-9]+)*)\.trycloudflare\.com\b/i;

/** Extracts a quick-tunnel URL (`https://<sub>.trycloudflare.com`) from a cloudflared output line. */
export function parseQuickTunnelUrl(line: string): string | null {
  const m = QUICK_URL_RE.exec(line);
  if (!m || !m[1]) return null;
  // cloudflared's own API host is not a tunnel URL
  if (m[1].toLowerCase() === 'api') return null;
  return `https://${m[1].toLowerCase()}.trycloudflare.com`;
}

/** True when a named-tunnel output line signals a successful edge registration. */
export function isNamedTunnelRegistered(line: string): boolean {
  return line.includes('Registered tunnel connection');
}
