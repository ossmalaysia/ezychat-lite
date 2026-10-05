import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ChatListQuery, ChatPatchBody, ResolveAllChatsBody } from '@wa-team-inbox/shared';
import { requireAdmin, requireUser } from '../auth/guards.js';
import { clientIp } from '../http/client-ip.js';
import type { AppContext } from '../context.js';
import { errors, parse } from '../http/errors.js';
import { getChats } from '../wa-bridge/index.js';

export const JidParams = z.object({ jid: z.string().min(3).max(256) });

/** Parses `:jid`; a phone number re-keyed to its WhatsApp ID opens that chat (old links, push). */
export function chatJidParam(ctx: AppContext, params: unknown): string {
  const { jid } = parse(JidParams, params);
  return getChats(ctx).resolveJid(jid);
}

export default async function chatsRoutes(app: FastifyInstance, ctx: AppContext) {
  const chats = getChats(ctx);
  app.addHook('preHandler', requireUser(ctx));
  const log = ctx.log.child({ mod: 'avatars' });
  app.get('/chats/open-count', { preHandler: requireAdmin(ctx) }, async () => ({
    openCount: chats.openCount(),
  }));
  app.post('/chats/resolve-all', { preHandler: requireAdmin(ctx) }, async (req) => {
    parse(ResolveAllChatsBody, req.body);
    const resolvedCount = chats.resolveAll(req.user!.id, clientIp(req));
    return { resolvedCount };
  });
  // Only visible image requests query WhatsApp. Bound the cache and coalesce concurrent requests.
  const cache = new Map<string, { until: number; url: Promise<string | null> }>();
  app.get('/chats/:jid/avatar', async (req, reply) => {
    const jid = chatJidParam(ctx, req.params);
    if (!chats.get(jid)) throw errors.notFound('Chat');
    reply.header('cache-control', 'private, max-age=300');
    if (ctx.wa.status.state !== 'open')
      return reply.header('cache-control', 'no-store').code(204).send();
    let entry = cache.get(jid);
    if (!entry || entry.until <= Date.now()) {
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      entry = {
        until: Date.now() + 5 * 60_000,
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
      cache.set(jid, entry);
    }
    const url = await entry.url;
    return url ? reply.redirect(url) : reply.code(204).send();
  });

  app.get('/chats', async (req) => {
    const q = parse(ChatListQuery, req.query);
    return chats.list(q, req.user!.id);
  });

  app.get('/chats/:jid', async (req) => {
    const jid = chatJidParam(ctx, req.params);
    const chat = chats.get(jid);
    if (!chat) throw errors.notFound('Chat');
    return { chat, events: chats.events(jid) };
  });

  app.patch('/chats/:jid', async (req) => {
    const jid = chatJidParam(ctx, req.params);
    const body = parse(ChatPatchBody, req.body ?? {});
    return chats.patch(jid, body, req.user!.id);
  });

  app.post('/chats/:jid/read', async (req) => {
    const jid = chatJidParam(ctx, req.params);
    await chats.markRead(jid, req.user!.id);
    return { ok: true };
  });
}
