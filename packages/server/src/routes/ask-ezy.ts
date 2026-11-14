import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AskEzyRequest,
  AskEzySettingsUpdate,
  type AskEzyEvent,
  type AskEzySettings,
  type AskEzyStatus,
} from '@ezychat/shared';
import { requireAdmin, requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { HttpError, errors, parse } from '../http/errors.js';
import { chosenChats } from '../inboxes/access.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { createAskEzyService } from '../ask-ezy/service.js';

/** Questions a user may ask per minute (each one costs model usage). */
export const ASK_EZY_PER_MINUTE = 20;
/** An empty line this often while a question runs (proxies close a silent response). */
export const ASK_EZY_KEEP_ALIVE_MS = 20_000;

/**
 * Ask Ezy (design: docs/features/ask-ezy/design.md). Every signed-in user asks; the answer streams as NDJSON
 * (`AskEzyEvent` per line) and stops when the client goes away. Changes Ezy proposed apply only through the
 * admin routes below.
 */
export default async function askEzyRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = createAskEzyService(ctx);
  const limiter = new WindowLimiter({ windowMs: 60_000, max: ASK_EZY_PER_MINUTE });

  app.get('/ask-ezy/status', { preHandler: requireUser(ctx) }, async (): Promise<AskEzyStatus> =>
    service.status(),
  );

  app.post('/ask-ezy', { preHandler: requireUser(ctx) }, async (req, reply) => {
    const body = parse(AskEzyRequest, req.body);
    const user = req.user!;
    // Ask Ezy reads across chats: never for an agent limited to chosen chats
    if (chosenChats(ctx, user))
      throw new HttpError(403, 'chat_scope_limited', 'Ask Ezy is not available for this account');
    const hit = limiter.hit(String(user.id));
    if (!hit.allowed) throw errors.rateLimited(hit.retryAfterSec);
    const cancel = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) cancel.abort();
    });
    let started = false;
    const begin = () => {
      if (started) return;
      started = true;
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
    };
    const write = (event: AskEzyEvent) => {
      begin();
      if (!reply.raw.writableEnded) reply.raw.write(JSON.stringify(event) + '\n');
    };
    // A question may run for minutes (the admin's limit): an empty line every 20 s keeps proxies such as the
    // Cloudflare tunnel (100 s without data) from closing it. The reader skips empty lines.
    const keepAlive = setInterval(() => {
      begin();
      if (!reply.raw.writableEnded) reply.raw.write('\n');
    }, ASK_EZY_KEEP_ALIVE_MS);
    try {
      // An error before the first line (no connection, unknown chat) is a normal JSON error answer.
      await service.ask(user, body, write, cancel.signal);
    } catch (error) {
      if (!started) throw error;
      write({ type: 'error', code: 'ai_unavailable' });
    } finally {
      clearInterval(keepAlive);
    }
    if (!started) write({ type: 'error', code: 'ai_unavailable' });
    reply.raw.end();
  });

  app.get(
    '/ask-ezy/settings',
    { preHandler: requireAdmin(ctx) },
    async (): Promise<AskEzySettings> => service.settings(),
  );
  app.put('/ask-ezy/settings', { preHandler: requireAdmin(ctx) }, async (req) =>
    service.updateSettings(parse(AskEzySettingsUpdate, req.body), {
      userId: req.user!.id,
      ip: clientIp(req),
    }),
  );

  const ChangeParams = z.object({
    id: z.string().min(1).max(64),
    action: z.enum(['apply', 'discard', 'undo']),
  });
  app.post('/ask-ezy/changes/:id/:action', { preHandler: requireAdmin(ctx) }, async (req) => {
    const { id, action } = parse(ChangeParams, req.params);
    const user = req.user!;
    const ip = clientIp(req);
    return service.act(id, action, user, ip);
  });
}
