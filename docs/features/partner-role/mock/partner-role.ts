import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../packages/server/src/context.js';
import { requireAdmin, requireUser } from '../../../../packages/server/src/auth/guards.js';

/**
 * Proposed (partner-role), mock only: an admin invites an outside partner (an outsourced agent) who
 * may open ONLY the direct chats and groups the admin shares with them. Stand-in routes
 * `/api/mock/partner-role*` keep partners, shares, the notes switch and the history in memory; the web
 * copy reads them to filter the chat list and pages. Production (design.md): role `partner` in the
 * users table, table `chat_shares` (migration 036), the chat-level scope in `inboxes/access.ts`, 404
 * outside shared chats, per-chat socket rooms and filtered push. Partners are real `agent` users
 * here because the server under the mock does not know the new role yet.
 */

export interface MockPartner {
  userId: number;
  company: string;
  invitedAt: number;
}

export interface MockShare {
  id: string;
  userId: number;
  chatJid: string;
  grantedBy: number;
  grantedAt: number;
  /** null = no end date. */
  expiresAt: number | null;
  /** null = the full history; else the partner sees messages from this time on. */
  historyFrom: number | null;
}

interface LogRow {
  at: number;
  by: string;
  action:
    | 'partner.invited'
    | 'chat_share.added'
    | 'chat_share.changed'
    | 'chat_share.removed'
    | 'chat_share.expired'
    | 'partner_notes.changed';
  partner: string;
  chat: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const state = {
  partners: new Map<number, MockPartner>(),
  shares: [] as MockShare[],
  /** Team switch: partners see internal notes in shared chats (default off). */
  notesForPartners: false,
  log: [] as LogRow[],
  /** Mock only: the partner page shows 40 fictional shares (long-list state). */
  longList: false,
};

const ShareBody = z.object({
  userId: z.number().int().positive(),
  chatJid: z.string().min(3).max(256),
  expiresAt: z.number().int().positive().nullable().default(null),
  historyFrom: z.number().int().positive().nullable().default(null),
});

export function registerPartnerRole(app: FastifyInstance, ctx: AppContext): void {
  const nameOf = (userId: number) =>
    (
      ctx.db.prepare('SELECT display_name AS n FROM users WHERE id = ?').get(userId) as
        { n: string } | undefined
    )?.n ?? `#${userId}`;
  const chatOf = (jid: string) =>
    ctx.db.prepare('SELECT name, type FROM chats WHERE jid = ?').get(jid) as
      { name: string; type: 'dm' | 'group' } | undefined;
  const log = (row: Omit<LogRow, 'at'>) => state.log.unshift({ at: Date.now(), ...row });

  /** Expired shares end on their own (production: a timer + on every scope check). */
  const sweep = () => {
    const now = Date.now();
    for (const s of state.shares.filter((x) => x.expiresAt !== null && x.expiresAt <= now)) {
      log({
        by: 'EzyChat',
        action: 'chat_share.expired',
        partner: nameOf(s.userId),
        chat: chatOf(s.chatJid)?.name ?? s.chatJid,
      });
    }
    state.shares = state.shares.filter((x) => x.expiresAt === null || x.expiresAt > now);
  };
  const view = (s: MockShare) => {
    const chat = chatOf(s.chatJid);
    return { ...s, chatName: chat?.name || s.chatJid, chatType: chat?.type ?? 'dm' };
  };

  app.get('/api/mock/partner-role', { preHandler: requireUser(ctx) }, async (req) => {
    sweep();
    const me = req.user!;
    const mine = state.partners.get(me.id);
    if (mine)
      return {
        me: {
          partner: true,
          company: mine.company,
          shares: state.shares.filter((s) => s.userId === me.id).map(view),
        },
        notesForPartners: state.notesForPartners,
      };
    if (me.role !== 'admin') return { me: { partner: false }, notesForPartners: false };
    return {
      me: { partner: false },
      notesForPartners: state.notesForPartners,
      longList: state.longList,
      partners: [...state.partners.values()].map((p) => ({
        ...p,
        displayName: nameOf(p.userId),
        shares: state.shares.filter((s) => s.userId === p.userId).map(view),
      })),
      log: state.log.slice(0, 50),
    };
  });

  app.post('/api/mock/partner-role/partners', { preHandler: requireAdmin(ctx) }, async (req) => {
    const body = z
      .object({ userId: z.number().int().positive(), company: z.string().max(80).default('') })
      .parse(req.body);
    state.partners.set(body.userId, { ...body, invitedAt: Date.now() });
    log({
      by: req.user!.displayName,
      action: 'partner.invited',
      partner: nameOf(body.userId),
      chat: null,
    });
    return { ok: true };
  });

  app.post('/api/mock/partner-role/shares', { preHandler: requireAdmin(ctx) }, async (req) => {
    const body = ShareBody.parse(req.body);
    if (!state.partners.has(body.userId)) return { error: 'not_partner' };
    const existing = state.shares.find(
      (s) => s.userId === body.userId && s.chatJid === body.chatJid,
    );
    if (existing) {
      existing.expiresAt = body.expiresAt;
      existing.historyFrom = body.historyFrom;
      log({
        by: req.user!.displayName,
        action: 'chat_share.changed',
        partner: nameOf(body.userId),
        chat: chatOf(body.chatJid)?.name ?? body.chatJid,
      });
      return view(existing);
    }
    const share: MockShare = {
      id: randomBytes(6).toString('hex'),
      ...body,
      grantedBy: req.user!.id,
      grantedAt: Date.now(),
    };
    state.shares.push(share);
    log({
      by: req.user!.displayName,
      action: 'chat_share.added',
      partner: nameOf(body.userId),
      chat: chatOf(body.chatJid)?.name ?? body.chatJid,
    });
    return view(share);
  });

  app.delete(
    '/api/mock/partner-role/shares/:id',
    { preHandler: requireAdmin(ctx) },
    async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const share = state.shares.find((s) => s.id === id);
      if (!share) return { ok: true };
      state.shares = state.shares.filter((s) => s.id !== id);
      log({
        by: req.user!.displayName,
        action: 'chat_share.removed',
        partner: nameOf(share.userId),
        chat: chatOf(share.chatJid)?.name ?? share.chatJid,
      });
      return { ok: true };
    },
  );

  app.put('/api/mock/partner-role/settings', { preHandler: requireAdmin(ctx) }, async (req) => {
    const body = z
      .object({ notesForPartners: z.boolean().optional(), longList: z.boolean().optional() })
      .parse(req.body);
    if (body.notesForPartners !== undefined && body.notesForPartners !== state.notesForPartners) {
      state.notesForPartners = body.notesForPartners;
      log({ by: req.user!.displayName, action: 'partner_notes.changed', partner: '', chat: null });
    }
    if (body.longList !== undefined) state.longList = body.longList;
    return { ok: true };
  });

  /** Mock only: a share ends now, as its end date would (shows "No longer shared" live). */
  app.post(
    '/api/mock/partner-role/shares/:id/expire',
    { preHandler: requireAdmin(ctx) },
    async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const share = state.shares.find((s) => s.id === id);
      if (share) share.expiresAt = Date.now() - 1;
      sweep();
      return { ok: true };
    },
  );
}

/** Demo: two partners (one with shares, one without) and three shared chats. */
export async function seedPartners(
  ctx: AppContext,
  adminId: number,
  partners: Array<{ id: number; company: string }>,
  call: (method: 'POST', path: string, body: unknown) => Promise<unknown>,
): Promise<void> {
  const now = Date.now();
  for (const p of partners)
    state.partners.set(p.id, { userId: p.id, company: p.company, invitedAt: now - 6 * DAY });
  const ravi = partners[0]!.id;
  const add = (
    chatJid: string,
    expiresAt: number | null,
    historyFrom: number | null,
    ago: number,
  ) =>
    state.shares.push({
      id: randomBytes(6).toString('hex'),
      userId: ravi,
      chatJid,
      grantedBy: adminId,
      grantedAt: now - ago,
      expiresAt,
      historyFrom,
    });
  add('60128814455@s.whatsapp.net', null, null, 5 * DAY); // Priya Nair: full history, no end
  add('60129001234@s.whatsapp.net', now + 3 * DAY, null, 2 * DAY); // Jason Lim: ends in 3 days
  // Kopi Lovers Club "from today on": its seeded talk moves to yesterday, one new message today, so
  // the partner sees the cut ("Earlier messages are not shared with you").
  const group = '120363025550002@g.us';
  ctx.db
    .prepare(
      'UPDATE messages SET timestamp = timestamp - ?, created_at = created_at - ? WHERE chat_jid = ?',
    )
    .run(DAY, DAY, group);
  ctx.db.prepare('UPDATE chat_events SET at = at - ? WHERE chat_jid = ?').run(DAY, group);
  add(group, null, startOfToday(), 0);
  await call('POST', '/dev/fake-incoming', {
    chatJid: group,
    senderJid: '60126677889@s.whatsapp.net',
    senderName: 'Nurul Huda',
    text: 'Morning all! Is the Saturday meet-up still at 10am?',
  });
  const by = 'Aisyah';
  state.log.push(
    {
      at: now - 60_000,
      by,
      action: 'chat_share.added',
      partner: 'Ravi Kumar',
      chat: 'Kopi Lovers Club',
    },
    { at: now - 2 * DAY, by, action: 'chat_share.added', partner: 'Ravi Kumar', chat: 'Jason Lim' },
    {
      at: now - 5 * DAY,
      by,
      action: 'chat_share.added',
      partner: 'Ravi Kumar',
      chat: 'Priya Nair',
    },
    { at: now - 6 * DAY, by, action: 'partner.invited', partner: 'Sofia Tan', chat: null },
    { at: now - 6 * DAY, by, action: 'partner.invited', partner: 'Ravi Kumar', chat: null },
  );
}
