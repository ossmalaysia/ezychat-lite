import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ChatListQuery, ChatPatchBody } from '@wa-team-inbox/shared';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { errors, parse } from '../http/errors.js';
import { getChats } from '../wa-bridge/index.js';

export const JidParams = z.object({ jid: z.string().min(3).max(256) });

export default async function chatsRoutes(app: FastifyInstance, ctx: AppContext) {
  const chats = getChats(ctx);
  app.addHook('preHandler', requireUser(ctx));

  app.get('/chats', async (req) => {
    const q = parse(ChatListQuery, req.query);
    return chats.list(q, req.user!.id);
  });

  app.get('/chats/:jid', async (req) => {
    const { jid } = parse(JidParams, req.params);
    const chat = chats.get(jid);
    if (!chat) throw errors.notFound('Chat');
    return { chat, events: chats.events(jid) };
  });

  app.patch('/chats/:jid', async (req) => {
    const { jid } = parse(JidParams, req.params);
    const body = parse(ChatPatchBody, req.body ?? {});
    return chats.patch(jid, body, req.user!.id);
  });

  app.post('/chats/:jid/read', async (req) => {
    const { jid } = parse(JidParams, req.params);
    await chats.markRead(jid, req.user!.id);
    return { ok: true };
  });
}
