import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { createGroupService, type GroupService } from '../groups/service.js';
import { clientIp } from '../http/client-ip.js';
import { parse } from '../http/errors.js';
import { createProfileImages } from '../http/profile-images.js';
import { chatJidParam } from './chats.js';

declare module '../context.js' {
  interface Services {
    groups?: GroupService;
  }
}

const MemberParams = z.object({
  jid: z.string().min(3).max(256),
  member: z.string().min(3).max(256),
});

/** Group info: members of a WhatsApp group chat. Read-only, except starting a direct chat. */
export default async function groupRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireUser(ctx));
  const groups = (ctx.services.groups ??= createGroupService(ctx));
  const photo = createProfileImages(ctx, ctx.log.child({ mod: 'groups' }), { max: 2000 });

  app.get('/chats/:jid/members', async (req) => groups.info(chatJidParam(ctx, req.params)));

  app.get('/chats/:jid/members/:member/about', async (req) => {
    const { member } = parse(MemberParams, req.params);
    return { about: await groups.about(chatJidParam(ctx, req.params), member) };
  });

  app.get('/chats/:jid/members/:member/avatar', async (req, reply) => {
    const { member } = parse(MemberParams, req.params);
    const groupJid = chatJidParam(ctx, req.params);
    if (ctx.wa.status.state !== 'open')
      return reply.header('cache-control', 'no-store').code(204).send();
    const url = await photo(await groups.photoJid(groupJid, member));
    reply.header('cache-control', 'private, max-age=300');
    return url ? reply.redirect(url) : reply.code(204).send();
  });

  app.post('/chats/:jid/members/:member/chat', async (req) => {
    const { member } = parse(MemberParams, req.params);
    const chatJid = await groups.startChat(chatJidParam(ctx, req.params), member, {
      userId: req.user!.id,
      ip: clientIp(req),
    });
    return { chatJid };
  });
}
