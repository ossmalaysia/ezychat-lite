import type { FastifyInstance } from 'fastify';
import { CustomerProfileBody, CustomerTagsQuery } from '@ezychat/shared';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { parse } from '../http/errors.js';
import { scopeFor } from '../inboxes/access.js';
import { chatJidParam } from './chats.js';

/** Customer profiles (lead info) on direct chats: every signed-in teammate reads and edits. */
export default async function customerRoutes(app: FastifyInstance, ctx: AppContext) {
  const customers = ctx.services.customers;
  if (!customers) throw new Error('customer service not initialized');
  app.addHook('preHandler', requireUser(ctx));

  app.get('/chats/:jid/profile', async (req) =>
    customers.profile(chatJidParam(ctx, req), { isAdmin: req.user!.role === 'admin' }),
  );

  app.put('/chats/:jid/profile', async (req) =>
    customers.save(chatJidParam(ctx, req), parse(CustomerProfileBody, req.body), {
      userId: req.user!.id,
      ip: clientIp(req),
      isAdmin: req.user!.role === 'admin',
    }),
  );

  app.get('/customer-tags', async (req) => {
    const scope = scopeFor(ctx, req.user!);
    return {
      tags: customers.suggestTags(
        parse(CustomerTagsQuery, req.query).q,
        scope === 'all' ? undefined : [...scope],
      ),
    };
  });
}
