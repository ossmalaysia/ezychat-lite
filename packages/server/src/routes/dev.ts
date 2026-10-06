import type { FastifyInstance } from 'fastify';
import { FakeIncomingBody, type Message } from '@wa-team-inbox/shared';
import type { FakeWaAdapter } from '@wa-team-inbox/wa';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { parse } from '../http/errors.js';

const INGEST_WAIT_MS = 2000;

function isFake(wa: unknown): wa is FakeWaAdapter {
  return typeof (wa as { simulateIncoming?: unknown }).simulateIncoming === 'function';
}

/**
 * POST /api/dev/fake-incoming: only registered with --fake-wa. Simulates an inbound WhatsApp
 * message on the FakeWaAdapter. When the messages service is present, waits (bounded) until the
 * WA bridge has ingested it so callers (e2e tests) can immediately see the chat.
 */
export default async function devRoutes(app: FastifyInstance, ctx: AppContext) {
  if (!ctx.config.fakeWa || !isFake(ctx.wa)) return;
  const wa = ctx.wa;

  app.post('/dev/fake-incoming', { preHandler: requireUser(ctx) }, async (req) => {
    const body = parse(FakeIncomingBody, req.body ?? {});
    const waitIngest = Boolean(ctx.services.messages);
    let expectId: string | null = null;
    let ingestedChatJid: string | null = null;
    let onNew: ((m: Message) => void) | null = null;
    let done: () => void = () => undefined;
    const ingested = new Promise<void>((resolve) => {
      done = resolve;
    });
    let timer: NodeJS.Timeout | null = null;
    if (waitIngest) {
      timer = setTimeout(done, INGEST_WAIT_MS);
      onNew = (m: Message) => {
        // The bridge may emit synchronously inside simulateIncoming (before expectId is known), so also
        // match on content. A known phone number is stored in its WhatsApp ID chat.
        const routed = ctx.services.aliases?.route(body.chatJid) ?? body.chatJid;
        const match =
          expectId !== null
            ? m.id === expectId
            : (m.chatJid === routed || m.chatJid === body.chatJid) &&
              (m.body ?? '') === body.text &&
              !m.fromMe;
        if (match) {
          ingestedChatJid = m.chatJid;
          done();
        }
      };
      ctx.bus.on('message:new', onNew);
    } else {
      done();
    }
    try {
      const msg = wa.simulateIncoming({
        chatJid: body.chatJid,
        ...(body.chatJidAlt ? { chatJidAlt: body.chatJidAlt } : {}),
        body: body.text,
        senderName: body.senderName ?? null,
        type: body.type ?? 'text',
        // A simulated voice note or photo: the fake adapter serves these bytes as the download.
        media: body.media
          ? {
              mime: body.media.mime,
              fileName: body.media.fileName ?? null,
              download: async () => Buffer.from(body.media!.base64, 'base64'),
            }
          : null,
      });
      expectId = msg.id;
      await ingested;
      return { id: msg.id, chatJid: ingestedChatJid ?? msg.chatJid, timestamp: msg.timestamp };
    } finally {
      if (timer) clearTimeout(timer);
      if (onNew) ctx.bus.off('message:new', onNew);
    }
  });
}
