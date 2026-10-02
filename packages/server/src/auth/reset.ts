import { audit } from '../db/audit.js';
import type { DB } from '../db/index.js';
import { generatePassword, hashPasswordSync } from './passwords.js';

/**
 * CLI-only admin recovery (`server --reset-admin`): sets a new random password for the first
 * (lowest id) admin, re-enables it, forces a password change and revokes its sessions.
 */
export function resetFirstAdmin(db: DB): { username: string; password: string } {
  const admin = db
    .prepare("SELECT id, username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    .get() as { id: number; username: string } | undefined;
  if (!admin) throw new Error('no admin user exists yet; open the app to run first-time setup');
  const password = generatePassword(12);
  const passwordHash = hashPasswordSync(password);
  db.transaction(() => {
    db.prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 1, disabled_at = NULL WHERE id = ?',
    ).run(passwordHash, admin.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(admin.id);
    audit(db, { userId: admin.id, action: 'auth.reset_admin_cli', ip: null });
  })();
  return { username: admin.username, password };
}
