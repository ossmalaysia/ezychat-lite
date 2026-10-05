import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MessageListQuery, SendTextBody } from '@wa-team-inbox/shared';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { errors, parse } from '../http/errors.js';
import { getChats, getMessages } from '../wa-bridge/index.js';
import { chatJidParam } from './chats.js';

const IdParams = z.object({ id: z.string().min(1).max(256) });
const MediaFields = z.object({
  clientId: z.string().min(1).max(64),
  caption: z.string().max(4096).optional(),
  quotedId: z.string().max(256).optional(),
});

export default async function messagesRoutes(app: FastifyInstance, ctx: AppContext) {
  const messages = getMessages(ctx);
  const chats = getChats(ctx);
  app.addHook('preHandler', requireUser(ctx));

  app.get('/chats/:jid/messages', async (req) => {
    const jid = chatJidParam(ctx, req.params);
    if (!chats.get(jid)) throw errors.notFound('Chat');
    const q = parse(MessageListQuery, req.query);
    return messages.list(jid, q);
  });

  app.post('/chats/:jid/messages', async (req, reply) => {
    const jid = chatJidParam(ctx, req.params);
    const body = parse(SendTextBody, req.body);
    const msg = messages.sendText(jid, body, req.user!.id);
    return reply.status(201).send(msg);
  });

  app.post('/chats/:jid/media', async (req, reply) => {
    const jid = chatJidParam(ctx, req.params);
    if (!req.isMultipart()) throw errors.validation('Expected multipart/form-data');
    const fields: Record<string, string> = {};
    let file: { buffer: Buffer; fileName: string } | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || file) {
          part.file.resume();
          continue;
        }
        file = { buffer: await part.toBuffer(), fileName: part.filename || 'file' };
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
    if (!file) throw errors.validation('file is required');
    const f = parse(MediaFields, fields);
    const msg = await messages.sendMedia(
      jid,
      { buffer: file.buffer, fileName: file.fileName, ...(f.caption ? { caption: f.caption } : {}), ...(f.quotedId ? { quotedId: f.quotedId } : {}) },
      req.user!.id,
      f.clientId,
    );
    return reply.status(201).send(msg);
  });

  app.post('/messages/:id/retry', async (req) => {
    const { id } = parse(IdParams, req.params);
    return messages.retry(id, req.user!.id);
  });
}
