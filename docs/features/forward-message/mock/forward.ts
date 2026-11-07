import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../packages/server/src/context.js';
import { requireUser } from '../../../../packages/server/src/auth/guards.js';
import { audit } from '../../../../packages/server/src/db/audit.js';
import { HttpError, parse } from '../../../../packages/server/src/http/errors.js';
import { getMessages } from '../../../../packages/server/src/wa-bridge/index.js';

/**
 * Proposed (forward-message): forward one message to up to 5 existing chats or groups. Mock stand-in for
 * `POST /api/messages/:id/forward` (design.md). The real message service sends each copy through the
 * normal send queue as the signed-in user; the app adds WhatsApp's forwarded mark
 * (`contextInfo.isForwarded` + `forwardingScore`) in the Baileys adapter and stores the score on the
 * message. The mock keeps the "Forwarded" marks in memory and serves them to the browser.
 *
 * The mock keeps inboxes and reply windows in the browser, so the browser names the chats whose 24-hour
 * window is closed; the app reads `chats.last_inbound_at` and the inbox's capabilities on the server and
 * never trusts the client for it.
 */

/** Mock-only scenarios, switched from the dashed Mock only box in the dialog. */
type Scenario = 'normal' | 'offline';

export const FORWARD_MAX_CHATS = 5;
/** A message WhatsApp marks "Forwarded many times" goes to one chat at a time (WhatsApp's own rule). */
export const MANY_TIMES_SCORE = 5;
const PER_MINUTE = 30;

export interface MockForwardState {
  scenario: Scenario;
  /** message id → forwarding score (1 = "Forwarded", ≥ 5 = "Forwarded many times"). */
  forwarded: Record<string, number>;
  /** Messages WhatsApp Safety rated High (their files are locked: never forwarded). */
  safetyLocked: string[];
  limits: { maxChats: number; manyTimesScore: number; perMinute: number };
}

const ForwardBody = z.object({
  messageId: z.string().min(1).max(256),
  to: z.array(z.string().min(1).max(256)).min(1).max(FORWARD_MAX_CHATS),
  clientRequestId: z.string().min(1).max(64),
  /** Mock only: the browser's list of picked chats whose reply window is closed. */
  closedWindow: z.array(z.string().max(256)).max(50).default([]),
});

const fail = (status: number, code: string, message: string) =>
  new HttpError(status, code, message);

interface Row {
  id: string;
  chat_jid: string;
  type: string;
  body: string | null;
  media_name: string | null;
  voice_note: number | null;
  deleted_at: number | null;
  status: string;
}

export function registerForward(app: FastifyInstance, ctx: AppContext): void {
  const messages = getMessages(ctx);
  const log = ctx.log.child({ mod: 'mock-forward' });
  let scenario: Scenario = 'normal';
  const done = new Map<string, { sent: number; messageIds: string[] }>();
  const perUser = new Map<number, number[]>();

  const state = (): MockForwardState => ({
    scenario,
    forwarded: Object.fromEntries(forwarded),
    safetyLocked: [...safetyLocked],
    limits: {
      maxChats: FORWARD_MAX_CHATS,
      manyTimesScore: MANY_TIMES_SCORE,
      perMinute: PER_MINUTE,
    },
  });

  app.get('/api/mock/forward', { preHandler: requireUser(ctx) }, () => state());

  // Mock only: the dashed box in the dialog switches the scenario (any signed-in user).
  app.put('/api/mock/forward/scenario', { preHandler: requireUser(ctx) }, (req) => {
    const body = parse(
      z.object({
        scenario: z.enum(['normal', 'offline']).optional(),
        /** Mark (or unmark) a message as Safety High, to show the locked state. */
        safetyLock: z.object({ messageId: z.string().max(256), locked: z.boolean() }).optional(),
      }),
      req.body,
    );
    if (body.scenario) scenario = body.scenario;
    if (body.safetyLock) {
      if (body.safetyLock.locked) safetyLocked.add(body.safetyLock.messageId);
      else safetyLocked.delete(body.safetyLock.messageId);
    }
    if (body.scenario === 'normal') perUser.clear();
    return state();
  });

  /** Mock of `POST /api/messages/:id/forward`. */
  app.post('/api/mock/forward', { preHandler: requireUser(ctx) }, async (req, reply) => {
    const user = req.user!;
    const body = parse(ForwardBody, req.body);
    const key = `${user.id}:${body.clientRequestId}`;
    const again = done.get(key);
    if (again) return reply.status(200).send(again);

    const row = ctx.db
      .prepare(
        'SELECT id, chat_jid, type, body, media_name, voice_note, deleted_at, status FROM messages WHERE id = ?',
      )
      .get(body.messageId) as Row | undefined;
    // The app answers 404 outside the caller's inboxes / chosen chats (requireMessageAccess).
    if (!row || row.type === 'system') throw fail(404, 'not_found', 'Message not found');
    if (row.deleted_at) throw fail(409, 'message_deleted', 'This message was deleted');
    if (row.id.startsWith('local-'))
      throw fail(409, 'message_not_sent', 'This message has not been sent yet');
    if (safetyLocked.has(row.id))
      throw fail(409, 'safety_locked', 'WhatsApp Safety locked this file');
    const to = [...new Set(body.to)];
    const score = (forwarded.get(row.id) ?? 0) + 1;
    if (score > MANY_TIMES_SCORE && to.length > 1)
      throw fail(400, 'forward_many_times', 'Forwarded many times: one chat at a time');
    // Every chat is checked before anything is sent: one bad chat sends nothing.
    const closed = to.filter((jid) => body.closedWindow.includes(jid));
    if (closed.length) throw fail(409, 'window_closed', 'The 24-hour reply window is closed');
    if (scenario === 'offline')
      throw fail(503, 'wa_disconnected', 'This WhatsApp number is not connected');
    const recent = (perUser.get(user.id) ?? []).filter((at) => at > Date.now() - 60_000);
    if (recent.length + to.length > PER_MINUTE)
      throw fail(429, 'rate_limited', `At most ${PER_MINUTE} forwards a minute`);
    perUser.set(user.id, [...recent, ...to.map(() => Date.now())]);

    // Media: the stored file (history media is downloaded first); fail before anything is queued.
    let file: { buffer: Buffer; fileName: string } | null = null;
    if (row.type !== 'text') {
      const media = await messages.ensureMedia(row.id);
      if (!media || media === 'unavailable')
        throw fail(502, 'media_unavailable', 'The file could not be downloaded from WhatsApp');
      file = {
        buffer: readFileSync(media.path),
        fileName: media.name ?? row.media_name ?? 'file',
      };
    }
    const messageIds: string[] = [];
    for (const [i, jid] of to.entries()) {
      const clientId = `fwd-${body.clientRequestId}-${i}`;
      const sent = file
        ? await messages.sendMedia(
            jid,
            {
              buffer: file.buffer,
              fileName: file.fileName,
              ...(row.body ? { caption: row.body } : {}),
              ...(row.voice_note ? { voiceNote: true } : {}),
            },
            user.id,
            clientId,
          )
        : messages.sendText(jid, { text: row.body ?? '', clientId }, user.id);
      forwarded.set(sent.id, score);
      pendingMarks.set(clientId, score);
      messageIds.push(sent.id);
    }
    audit(ctx.db, {
      userId: user.id,
      action: 'message.forwarded',
      ip: req.ip,
      meta: { messageId: row.id, chatJids: to, messageIds },
    });
    log.info({ userId: user.id, count: to.length, type: row.type }, 'message forwarded');
    const result = { sent: to.length, messageIds };
    done.set(key, result);
    return reply.status(201).send(result);
  });

  // A queued copy has a local id until WhatsApp takes it, then WhatsApp's id: keep the mark.
  ctx.bus.on('message:status', (u) => {
    const s = u.clientId ? pendingMarks.get(u.clientId) : undefined;
    if (s !== undefined && u.newId) forwarded.set(u.newId, s);
  });
}

/** message id → forwarding score (shared by the routes and the seed). */
const forwarded = new Map<string, number>();
const safetyLocked = new Set<string>();
const pendingMarks = new Map<string, number>();

// A 1×1 PDF page with a title line: enough for the file bubble (name, size, icon).
const MENU_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
    '4 0 obj<</Length 52>>stream\nBT /F1 18 Tf 40 100 Td (Catering menu Nov) Tj ET\nendstream endobj\n' +
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

type Call = (method: 'POST', path: string, body: unknown) => Promise<{ id: string }>;

/**
 * Seed: Priya sends a photo of her parcel and Farah the catering menu PDF (things a team forwards to a
 * colleague's group); Jason's message arrived "Forwarded", Nurul's "Forwarded many times".
 */
export async function seedForward(call: Call, publicDir: string): Promise<void> {
  const photo = readFileSync(join(publicDir, 'illustrations', 'empty-inbox.png'));
  await call('POST', '/dev/fake-incoming', {
    chatJid: '60128814455@s.whatsapp.net',
    senderName: 'Priya Nair',
    text: 'This is the box I got, the lid is broken',
    type: 'image',
    media: { mime: 'image/png', base64: photo.toString('base64') },
  });
  await call('POST', '/dev/fake-incoming', {
    chatJid: '60123110021@s.whatsapp.net',
    senderName: 'Farah Aziz',
    text: 'Our menu for the 30 pax event, please check',
    type: 'document',
    media: {
      mime: 'application/pdf',
      fileName: 'Catering menu Nov.pdf',
      base64: MENU_PDF.toString('base64'),
    },
  });
  const jason = await call('POST', '/dev/fake-incoming', {
    chatJid: '60129001234@s.whatsapp.net',
    senderName: 'Jason Lim',
    text: 'Kopi Apong promo this week: buy 2 Kopi Peng get 1 free (until Sunday)',
  });
  forwarded.set(jason.id, 1);
  const nurul = await call('POST', '/dev/fake-incoming', {
    chatJid: '60126677889@s.whatsapp.net',
    senderName: 'Nurul Huda',
    text: 'URGENT: all shops in Penang closed tomorrow, share with everyone!!',
  });
  forwarded.set(nurul.id, 7);
}
