import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  FixEnglishBody,
  FixGrammarBody,
  TeamWordBody,
  type FixEnglishStatus,
} from '@ezychat/shared';
import { requireAdmin, requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { fixEnglishEnabled, fixEnglishUpgraded, setFixEnglish } from '../fix-english/setting.js';
import { TeamWordStore } from '../fix-english/words.js';
import { clientIp } from '../http/client-ip.js';
import { errors, parse } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { chatJidParam } from './chats.js';

/**
 * Fix English (design: docs/features/grammar-fix/design.md): the team-wide switch (any user reads it
 * at /api/fix-english, admins change it at /api/ai/fix-english), the team words, and the per-chat
 * grammar check (404 outside the caller's inboxes through `chatJidParam`; direct chats and groups).
 * Spelling never reaches the server: the browser checks it against its own dictionary.
 */
export default async function fixEnglishRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireUser(ctx));
  const words = new TeamWordStore(ctx.db);
  const grammarLimiter = new WindowLimiter({ windowMs: 60_000, max: 120 });
  const wordLimiter = new WindowLimiter({ windowMs: 60_000, max: 30 });
  const limit = (limiter: WindowLimiter, req: FastifyRequest) => {
    const result = limiter.hit(String(req.user!.id));
    if (!result.allowed) throw errors.rateLimited(result.retryAfterSec);
  };
  const actor = (req: FastifyRequest) => ({ userId: req.user!.id, ip: clientIp(req) });
  const status = (): FixEnglishStatus => {
    const enabled = fixEnglishEnabled(ctx.settings);
    const connection = ctx.services.ai?.draftConnection() ?? 'none';
    let grammar: FixEnglishStatus['grammar'] = 'off';
    if (enabled) grammar = connection === 'ready' ? 'on' : connection;
    return {
      enabled,
      connected: connection === 'ready',
      spelling: enabled ? 'on' : 'off',
      grammar,
      upgraded: fixEnglishUpgraded(ctx.settings),
    };
  };

  // Outside /api/ai on purpose: every /api/ai route is admin-only (ai-routes-access.test.ts).
  app.get('/fix-english', async () => status());
  app.put('/ai/fix-english', { preHandler: requireAdmin(ctx) }, async (req) => {
    setFixEnglish(ctx, parse(FixEnglishBody, req.body).enabled, actor(req));
    return status();
  });

  app.get('/fix-english/words', async () => words.list());
  app.post('/fix-english/words', async (req) => {
    limit(wordLimiter, req);
    return words.add(parse(TeamWordBody, req.body).word, actor(req));
  });
  app.delete('/fix-english/words/:word', { preHandler: requireAdmin(ctx) }, async (req) =>
    words.remove(
      parse(z.object({ word: z.string().min(1).max(100) }), req.params).word,
      actor(req),
    ),
  );

  app.post('/chats/:jid/ai/fix-grammar', async (req, reply) => {
    const { text } = parse(FixGrammarBody, req.body);
    limit(grammarLimiter, req);
    const jid = chatJidParam(ctx, req);
    const ai = ctx.services.ai;
    if (!ai) throw errors.conflict('The grammar check is not available');
    const cancel = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) cancel.abort();
    });
    return ai.fixGrammar(jid, text, cancel.signal);
  });
}
