import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditEntry } from '@wa-team-inbox/shared';
import { requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { parse } from '../http/errors.js';

const AuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  /** return entries with id < before (cursor = last id of the previous page) */
  before: z.coerce.number().int().positive().optional(),
});

interface AuditRow {
  id: number;
  user_id: number | null;
  action: string;
  ip: string | null;
  meta: string;
  at: number;
}

function parseMeta(s: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Admin: GET /api/audit?limit=&before= → { entries } newest first. */
export default async function auditRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireAdmin(ctx));

  app.get('/audit', async (req): Promise<{ entries: AuditEntry[] }> => {
    const q = parse(AuditQuery, req.query ?? {});
    const rows = (
      q.before !== undefined
        ? ctx.db
            .prepare(
              'SELECT id, user_id, action, ip, meta, at FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?',
            )
            .all(q.before, q.limit)
        : ctx.db
            .prepare(
              'SELECT id, user_id, action, ip, meta, at FROM audit_log ORDER BY id DESC LIMIT ?',
            )
            .all(q.limit)
    ) as AuditRow[];
    // Revoked tokens are looked up too: the entry must still name the token that made the change.
    const tokenById = ctx.db.prepare('SELECT name, prefix FROM api_tokens WHERE id = ?');
    const tokens = new Map<number, { name: string; prefix: string } | null>();
    const tokenOf = (meta: Record<string, unknown>) => {
      if (meta.via !== 'mcp' || typeof meta.tokenId !== 'number') return null;
      if (!tokens.has(meta.tokenId)) {
        const row = tokenById.get(meta.tokenId) as { name: string; prefix: string } | undefined;
        tokens.set(meta.tokenId, row ?? null);
      }
      return tokens.get(meta.tokenId)!;
    };
    return {
      entries: rows.map((r) => {
        const meta = parseMeta(r.meta);
        return {
          id: r.id,
          userId: r.user_id,
          action: r.action,
          ip: r.ip,
          meta,
          at: r.at,
          apiToken: tokenOf(meta),
        };
      }),
    };
  });
}
