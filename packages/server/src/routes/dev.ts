import type { FastifyInstance } from 'fastify';
import { FakeGroupBody, FakeIncomingBody, type Message } from '@wa-team-inbox/shared';
import type { WaGroupParticipant } from '@wa-team-inbox/wa';
import type { FakeWaAdapter } from '@wa-team-inbox/wa';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { parse } from '../http/errors.js';
import { getChats } from '../wa-bridge/index.js';

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

  /**
   * POST /api/dev/fake-group: a group with members for the Group info panel. Every 4th generated
   * member has a known name, every 7th only a WhatsApp ID (number hidden), every 11th a username.
   */
  app.post('/dev/fake-group', { preHandler: requireUser(ctx) }, async (req) => {
    const body = parse(FakeGroupBody, req.body ?? {});
    const participants: WaGroupParticipant[] = [];
    const contacts: Array<{ jid: string; pushName: string | null; savedName: null }> = [];
    const me = ctx.wa.status.me?.jid.replace(/:\d+@/, '@');
    if (me)
      participants.push({
        jid: me,
        phoneJid: me,
        lidJid: null,
        username: null,
        role: 'superadmin',
      });
    const add = (m: {
      phone?: string;
      lid?: string;
      name?: string;
      username?: string;
      about?: string;
      role: WaGroupParticipant['role'];
    }) => {
      const phoneJid = m.phone ? `${m.phone}@s.whatsapp.net` : null;
      const lidJid = m.lid ? `${m.lid}@lid` : null;
      const jid = lidJid ?? phoneJid;
      if (!jid) return;
      participants.push({ jid, phoneJid, lidJid, username: m.username ?? null, role: m.role });
      if (m.name) contacts.push({ jid: phoneJid ?? jid, pushName: m.name, savedName: null });
      if (m.about) wa.setAbout(phoneJid ?? jid, m.about);
    };
    for (const m of body.members) add(m);
    for (let i = 1; i <= body.generated; i++) {
      const hidden = i % 7 === 0;
      add({
        phone: hidden ? undefined : `6011${String(10_000_000 + i).slice(-8)}`,
        lid: hidden ? `9${String(100_000_000_000_000 + i)}` : undefined,
        name: i % 4 === 0 ? `Demo Member ${i}` : undefined,
        username: i % 11 === 0 ? `demo.member.${i}` : undefined,
        role: i <= 2 ? 'admin' : 'member',
      });
    }
    wa.setGroupInfo({
      jid: body.groupJid,
      name: body.name,
      description: null,
      createdAt: Date.now() - 200 * 86_400_000,
      ownerJid: participants[1]?.phoneJid ?? participants[1]?.jid ?? null,
      size: participants.length,
      participants,
    });
    getChats(ctx).upsertContacts(contacts);
    getChats(ctx).upsertFromWa({ jid: body.groupJid, type: 'group', name: body.name });
    wa.simulateGroupChanged(body.groupJid);
    return { groupJid: body.groupJid, members: participants.length };
  });
}
