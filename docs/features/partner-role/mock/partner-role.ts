import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../packages/server/src/context.js';
import { requireAdmin, requireUser } from '../../../../packages/server/src/auth/guards.js';

/**
 * Proposed (partner-role), mock only: an admin invites an outside partner (an outsourced agent) who
 * may open ONLY the direct chats and groups the admin shares with them. Stand-in routes
 * `/api/mock/partner-role*` keep partners, shares and the history in memory; the web copy reads them
 * to filter the chat list and pages. Production (design.md): role `partner` in the users table,
 * table `chat_shares` (migration 036), the chat-level scope in `inboxes/access.ts`, 404 outside
 * shared chats, per-chat socket rooms and filtered push. Owner 2026-11-06: keep it simple, so a
 * share has no end date and no history limit (full history), and internal notes are never shown to
 * partners. Partners are real `agent` users here because the server under the mock does not know
 * the new role yet.
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
}

interface LogRow {
  at: number;
  by: string;
  action: 'partner.invited' | 'chat_share.added' | 'chat_share.removed';
  partner: string;
  chat: string | null;
}

const DAY = 24 * 60 * 60 * 1000;

const state = {
  partners: new Map<number, MockPartner>(),
  shares: [] as MockShare[],
  log: [] as LogRow[],
  /** Mock only: the partner page shows 40 fictional shares (long-list state). */
  longList: false,
};

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
  const view = (s: MockShare) => {
    const chat = chatOf(s.chatJid);
    return { ...s, chatName: chat?.name || s.chatJid, chatType: chat?.type ?? 'dm' };
  };

  app.get('/api/mock/partner-role', { preHandler: requireUser(ctx) }, async (req) => {
    const me = req.user!;
    const mine = state.partners.get(me.id);
    if (mine)
      return {
        me: {
          partner: true,
          company: mine.company,
          shares: state.shares.filter((s) => s.userId === me.id).map(view),
        },
      };
    if (me.role !== 'admin') return { me: { partner: false } };
    return {
      me: { partner: false },
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
    const body = z
      .object({ userId: z.number().int().positive(), chatJid: z.string().min(3).max(256) })
      .parse(req.body);
    if (!state.partners.has(body.userId)) return { error: 'not_partner' };
    const existing = state.shares.find(
      (s) => s.userId === body.userId && s.chatJid === body.chatJid,
    );
    if (existing) return view(existing);
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
    state.longList = z.object({ longList: z.boolean() }).parse(req.body).longList;
    return { ok: true };
  });
}

/** Demo: two partners (one with shares, one without) and three shared chats. */
export function seedPartners(
  adminId: number,
  partners: Array<{ id: number; company: string }>,
): void {
  const now = Date.now();
  for (const p of partners)
    state.partners.set(p.id, { userId: p.id, company: p.company, invitedAt: now - 6 * DAY });
  const ravi = partners[0]!.id;
  const add = (chatJid: string, ago: number) =>
    state.shares.push({
      id: randomBytes(6).toString('hex'),
      userId: ravi,
      chatJid,
      grantedBy: adminId,
      grantedAt: now - ago,
    });
  add('60128814455@s.whatsapp.net', 5 * DAY); // Priya Nair
  add('60129001234@s.whatsapp.net', 2 * DAY); // Jason Lim
  add('120363025550002@g.us', 1 * DAY); // Kopi Lovers Club (group)
  const by = 'Aisyah';
  const row = (ago: number, action: LogRow['action'], partner: string, chat: string | null) =>
    state.log.push({ at: now - ago, by, action, partner, chat });
  row(1 * DAY, 'chat_share.added', 'Ravi Kumar', 'Kopi Lovers Club');
  row(2 * DAY, 'chat_share.added', 'Ravi Kumar', 'Jason Lim');
  row(5 * DAY, 'chat_share.added', 'Ravi Kumar', 'Priya Nair');
  row(6 * DAY, 'partner.invited', 'Sofia Tan', null);
  row(6 * DAY, 'partner.invited', 'Ravi Kumar', null);
}
