import type { DB } from './index.js';

export function audit(
  db: DB,
  e: { userId: number | null; action: string; ip: string | null; meta?: Record<string, unknown> },
): void {
  db.prepare('INSERT INTO audit_log (user_id, action, ip, meta, at) VALUES (?, ?, ?, ?, ?)').run(
    e.userId,
    e.action,
    e.ip,
    JSON.stringify(e.meta ?? {}),
    Date.now(),
  );
}
