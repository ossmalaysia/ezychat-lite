import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ReplyCompleteBody,
  ReplySuggestionsBody,
  type ReplySuggestionsStatus,
} from '@ezychat/shared';
import {
  replySuggestionsEnabled,
  replySuggestionsUpgraded,
  setReplySuggestions,
} from '../ai/reply-suggestions-setting.js';
import { requireAdmin, requireUser } from '../auth/guards.js';
import { ChatRepo } from '../chats/repo.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { errors, parse } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { chatJidParam } from './chats.js';

/**
 * AI reply suggestions (design: docs/features/ai-reply-suggestions/design.md): the team-wide switch
 * (any user reads it at /api/reply-suggestions, admins change it at /api/ai/reply-suggestions) and the two per-chat calls. Per-chat routes answer 404
 * outside the caller's inboxes (`chatJidParam`) and work in direct chats only.
 */
export default async function replySuggestionRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireUser(ctx));
  const ai = ctx.services.ai!;
  const chats = new ChatRepo(ctx.db);
  const suggestLimiter = new WindowLimiter({ windowMs: 60_000, max: 20 });
  const completeLimiter = new WindowLimiter({ windowMs: 60_000, max: 60 });
  const limit = (limiter: WindowLimiter, req: FastifyRequest) => {
    const result = limiter.hit(String(req.user!.id));
    if (!result.allowed) throw errors.rateLimited(result.retryAfterSec);
  };
  const status = (): ReplySuggestionsStatus => {
    const enabled = replySuggestionsEnabled(ctx.settings);
    const connection = ai.draftConnection();
    return {
      enabled,
      connected: connection === 'ready',
      state:
        !enabled || connection === 'none' ? 'off' : connection === 'ready' ? 'on' : 'unavailable',
      upgraded: replySuggestionsUpgraded(ctx.settings),
    };
  };
  /** A direct chat the caller may open; the model call stops when the client goes away. */
  const draftChat = (req: FastifyRequest, reply: FastifyReply) => {
    const jid = chatJidParam(ctx, req);
    if (chats.get(jid)?.type !== 'dm')
      throw errors.validation('Reply suggestions work in direct chats only');
    const cancel = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) cancel.abort();
    });
    return { jid, signal: cancel.signal };
  };

  // Outside /api/ai on purpose: every /api/ai route is admin-only (ai-routes-access.test.ts).
  app.get('/reply-suggestions', async () => status());
  app.put('/ai/reply-suggestions', { preHandler: requireAdmin(ctx) }, async (req) => {
    const { enabled } = parse(ReplySuggestionsBody, req.body);
    setReplySuggestions(ctx, enabled, { userId: req.user!.id, ip: clientIp(req) });
    return status();
  });
  app.post('/chats/:jid/ai/suggestions', async (req, reply) => {
    limit(suggestLimiter, req);
    const { jid, signal } = draftChat(req, reply);
    return ai.draftReply(jid, { kind: 'suggest' }, signal);
  });
  app.post('/chats/:jid/ai/complete', async (req, reply) => {
    const { text } = parse(ReplyCompleteBody, req.body);
    limit(completeLimiter, req);
    const { jid, signal } = draftChat(req, reply);
    return ai.draftReply(jid, { kind: 'complete', typed: text }, signal);
  });
}
