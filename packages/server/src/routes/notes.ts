import type { FastifyInstance } from 'fastify';
import { NoteBody } from '@wa-team-inbox/shared';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { errors, parse } from '../http/errors.js';
import { getChats } from '../wa-bridge/index.js';
import { JidParams } from './chats.js';

export default async function notesRoutes(app: FastifyInstance, ctx: AppContext) {
  const chats = getChats(ctx);
  app.addHook('preHandler', requireUser(ctx));

  app.get('/chats/:jid/notes', async (req) => {
    const { jid } = parse(JidParams, req.params);
    if (!chats.get(jid)) throw errors.notFound('Chat');
    return { notes: chats.listNotes(jid) };
  });

  app.post('/chats/:jid/notes', async (req, reply) => {
    const { jid } = parse(JidParams, req.params);
    const { body } = parse(NoteBody, req.body);
    const note = chats.addNote(jid, req.user!.id, body);
    return reply.status(201).send(note);
  });
}
