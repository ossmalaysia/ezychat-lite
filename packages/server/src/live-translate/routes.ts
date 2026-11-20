import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ChatTranslateBody,
  LiveTranslateSettingsBody,
  TranslateDraftBody,
  TranslationsBody,
  type ChatTranslateState,
  type LiveTranslateStatus,
  type TranslateDraft,
  type TranslationsResponse,
} from '@ezychat/shared';
import { requireAdmin, requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { errors, parse } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { chatJidParam } from '../routes/chats.js';
import type { LiveTranslateService } from './service.js';

/**
 * Live translate routes (docs/live-translate.md). Per-chat routes resolve `:jid` through
 * `chatJidParam`: 404 outside the caller's inboxes or chosen chats, and for hidden chats.
 */
export default async function liveTranslateRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireUser(ctx));
  const translationsLimiter = new WindowLimiter({ windowMs: 60_000, max: 120 });
  const draftLimiter = new WindowLimiter({ windowMs: 60_000, max: 60 });
  const limit = (limiter: WindowLimiter, req: FastifyRequest) => {
    const result = limiter.hit(String(req.user!.id));
    if (!result.allowed) throw errors.rateLimited(result.retryAfterSec);
  };
  const service = (): LiveTranslateService => {
    const s = ctx.services.liveTranslate;
    if (!s) throw errors.notFound('Live translate');
    return s;
  };
  const abortOnClose = (reply: FastifyReply) => {
    const cancel = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) cancel.abort();
    });
    return cancel.signal;
  };

  app.get('/live-translate', async (req): Promise<LiveTranslateStatus> =>
    service().status(req.user!),
  );
  app.put(
    '/live-translate/settings',
    { preHandler: requireAdmin(ctx) },
    async (req): Promise<LiveTranslateStatus> => {
      service().setSettings(parse(LiveTranslateSettingsBody, req.body), {
        userId: req.user!.id,
        ip: clientIp(req),
      });
      return service().status(req.user!);
    },
  );

  app.get('/chats/:jid/live-translate', async (req): Promise<ChatTranslateState> => {
    const jid = chatJidParam(ctx, req);
    return service().chatState(req.user!, jid);
  });
  app.put('/chats/:jid/live-translate', async (req): Promise<ChatTranslateState> => {
    const jid = chatJidParam(ctx, req);
    return service().setChatState(req.user!, jid, parse(ChatTranslateBody, req.body));
  });

  app.post('/chats/:jid/translations', async (req, reply): Promise<TranslationsResponse> => {
    const body = parse(TranslationsBody, req.body);
    limit(translationsLimiter, req);
    const jid = chatJidParam(ctx, req);
    const translations = await service().translateMessages(
      req.user!,
      jid,
      body.messageIds,
      body.target,
      abortOnClose(reply),
    );
    return { translations };
  });

  app.post('/chats/:jid/translate-draft', async (req, reply): Promise<TranslateDraft> => {
    const body = parse(TranslateDraftBody, req.body);
    limit(draftLimiter, req);
    const jid = chatJidParam(ctx, req);
    return service().translateDraft(req.user!, jid, body.text, body.target, abortOnClose(reply));
  });
}
