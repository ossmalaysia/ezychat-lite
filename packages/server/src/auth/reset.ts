// STUB written by Task 5 so cli.ts compiles and works; Task 6 replaces this file wholesale
// (same path + signature). Uses argon2id via @node-rs/argon2 like the real auth service.
import { hashSync } from '@node-rs/argon2';
import { randomToken } from '../crypto/secret.js';
import type { DB } from '../db/index.js';

/** Sets a new random password for the first (lowest id) admin, forces change, revokes sessions. */
export function resetFirstAdmin(db: DB): { username: string; password: string } {
  const admin = db
    .prepare("SELECT id, username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    .get() as { id: number; username: string } | undefined;
  if (!admin) throw new Error('no admin user exists yet; open the app to run first-time setup');
  const password = randomToken(9);
  const hash = hashSync(password);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, disabled_at = NULL WHERE id = ?').run(
      hash,
      admin.id,
    );
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(admin.id);
    db.prepare('INSERT INTO audit_log (user_id, action, ip, meta, at) VALUES (?, ?, ?, ?, ?)').run(
      admin.id,
      'auth.reset_admin_cli',
      null,
      '{}',
      Date.now(),
    );
  })();
  return { username: admin.username, password };
}
