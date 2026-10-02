import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { QuickReplyBody, type QuickReply } from '@wa-team-inbox/shared';
import { requireAdmin, requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { clientIp } from '../http/client-ip.js';
import { errors, parse } from '../http/errors.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const QuickReplyPatch = QuickReplyBody.partial();

interface QuickReplyRow {
  id: number;
  shortcut: string;
  body: string;
  updated_at: number;
}

const toQuickReply = (r: QuickReplyRow): QuickReply => ({ id: r.id, shortcut: r.shortcut, body: r.body, updatedAt: r.updated_at });

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && String((err as { code?: unknown }).code).startsWith('SQLITE_CONSTRAINT');
}

export default async function quickRepliesRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const get = (id: number) => (db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(id) as QuickReplyRow | undefined) ?? null;
  const admin = { preHandler: requireAdmin(ctx) };

  app.get('/quick-replies', { preHandler: requireUser(ctx) }, async () => {
    const rows = db.prepare('SELECT * FROM quick_replies ORDER BY shortcut ASC').all() as QuickReplyRow[];
    return { quickReplies: rows.map(toQuickReply) };
  });

  app.post('/quick-replies', admin, async (req, reply) => {
    const body = parse(QuickReplyBody, req.body);
    let id: number;
    try {
      id = Number(
        db
          .prepare('INSERT INTO quick_replies (shortcut, body, created_by, updated_at) VALUES (?, ?, ?, ?)')
          .run(body.shortcut, body.body, req.user!.id, Date.now()).lastInsertRowid,
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw errors.conflict(`Shortcut "${body.shortcut}" already exists`);
      throw err;
    }
    audit(db, { userId: req.user!.id, action: 'quick_reply.create', ip: clientIp(req), meta: { id, shortcut: body.shortcut } });
    return reply.status(201).send(toQuickReply(get(id)!));
  });

  app.patch('/quick-replies/:id', admin, async (req) => {
    const { id } = parse(IdParams, req.params);
    const patch = parse(QuickReplyPatch, req.body ?? {});
    const cur = get(id);
    if (!cur) throw errors.notFound('Quick reply');
    try {
      db.prepare('UPDATE quick_replies SET shortcut = ?, body = ?, updated_at = ? WHERE id = ?').run(
        patch.shortcut ?? cur.shortcut,
        patch.body ?? cur.body,
        Date.now(),
        id,
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw errors.conflict(`Shortcut "${patch.shortcut}" already exists`);
      throw err;
    }
    audit(db, { userId: req.user!.id, action: 'quick_reply.update', ip: clientIp(req), meta: { id } });
    return toQuickReply(get(id)!);
  });

  app.delete('/quick-replies/:id', admin, async (req) => {
    const { id } = parse(IdParams, req.params);
    const info = db.prepare('DELETE FROM quick_replies WHERE id = ?').run(id);
    if (!info.changes) throw errors.notFound('Quick reply');
    audit(db, { userId: req.user!.id, action: 'quick_reply.delete', ip: clientIp(req), meta: { id } });
    return { ok: true };
  });
}
