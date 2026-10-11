import type { Logger } from 'pino';
import type { AppContext } from '../context.js';

/**
 * WhatsApp profile photo URLs, fetched only when an image is actually requested. Bounded cache with
 * coalesced requests; only https URLs on WhatsApp's own hosts are ever redirected to.
 */
export function createProfileImages(
  ctx: AppContext,
  log: Logger,
  opts: { ttlMs?: number; max?: number } = {},
): (jid: string, key?: string) => Promise<string | null> {
  const ttl = opts.ttlMs ?? 5 * 60_000;
  const max = opts.max ?? 500;
  const cache = new Map<string, { until: number; url: Promise<string | null> }>();
  return (jid, key = jid) => {
    let entry = cache.get(key);
    if (!entry || entry.until <= Date.now()) {
      if (cache.size >= max) cache.delete(cache.keys().next().value!);
      entry = {
        until: Date.now() + ttl,
        url: ctx.wa
          .getProfilePicture(jid)
          .then((url) => {
            if (!url) return null;
            const parsed = new URL(url);
            if (
              parsed.protocol !== 'https:' ||
              !parsed.hostname.endsWith('.whatsapp.net') ||
              parsed.username ||
              parsed.password ||
              parsed.port
            ) {
              log.warn({ jid }, 'Rejected profile image destination');
              return null;
            }
            return parsed.href;
          })
          .catch((err: unknown) => {
            log.debug({ err, jid }, 'Profile image unavailable');
            return null;
          }),
      };
      cache.set(key, entry);
    }
    return entry.url;
  };
}
