import type { Logger } from 'pino';
import type { AppContext } from '../context.js';
import { PRIMARY_INBOX_ID, parseChatKey } from '../inboxes/keys.js';

/**
 * WhatsApp profile photo URLs, fetched only when an image is actually requested. Bounded cache with
 * coalesced requests; a failed lookup rejects and is not cached. Only https URLs on WhatsApp's own
 * hosts are ever redirected to. `chatKey` names whose photo, as a chat key (`<waJid>#<inboxId>`;
 * a plain JID is inbox 1): the photo is asked through that inbox's own phone.
 */
export function createProfileImages(
  ctx: AppContext,
  log: Logger,
  opts: { ttlMs?: number; max?: number } = {},
): (chatKey: string, key?: string) => Promise<string | null> {
  const ttl = opts.ttlMs ?? 5 * 60_000;
  const max = opts.max ?? 500;
  const cache = new Map<string, { until: number; url: Promise<string | null> }>();
  return (chatKey, key = chatKey) => {
    const cached = cache.get(key);
    if (cached && cached.until > Date.now()) return cached.url;
    if (cache.size >= max) cache.delete(cache.keys().next().value!);
    let jid: string;
    let wa: AppContext['wa'];
    try {
      const target = parseChatKey(chatKey);
      jid = target.waJid;
      // a removed inbox has no phone: its adapter() throws, answered as "unavailable"
      wa =
        target.inboxId === PRIMARY_INBOX_ID
          ? ctx.wa
          : ctx.inboxes.connections.adapter(target.inboxId);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    const entry: { until: number; url: Promise<string | null> } = {
      until: Date.now() + ttl,
      url: wa
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
          // A failed lookup is not "no photo": drop it so the next request asks again.
          if (cache.get(key) === entry) cache.delete(key);
          log.debug({ err, jid }, 'Profile image unavailable');
          throw err;
        }),
    };
    cache.set(key, entry);
    return entry.url;
  };
}
