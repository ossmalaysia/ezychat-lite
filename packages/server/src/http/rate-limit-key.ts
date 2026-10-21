import { isIP } from 'node:net';

/**
 * The key that rate limits count a client by. IPv4 is the address itself (an IPv4-mapped IPv6
 * address too). IPv6 is the /64 network: one client usually holds a whole /64 and can change its
 * address inside it at will, so a per-address limit would reset on every change. Anything else
 * (e.g. 'unknown') is returned unchanged. Logs and audit rows keep the full address.
 */
export function rateLimitKey(ip: string): string {
  const address = ip.split('%')[0]!; // drop an IPv6 zone id (fe80::1%eth0)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped && isIP(mapped[1]!) === 4) return mapped[1]!;
  if (isIP(address) !== 6) return ip;
  return `${ipv6Groups(address).slice(0, 4).join(':')}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address, lower case, without leading zeros. */
function ipv6Groups(address: string): string[] {
  let text = address.toLowerCase();
  // An IPv4 tail (64:ff9b::192.0.2.33) is two groups.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text =
      text.slice(0, tail.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const zeros = rest === undefined ? [] : Array(8 - left.length - right.length).fill('0');
  return [...left, ...zeros, ...right].map((group) => parseInt(group, 16).toString(16));
}
