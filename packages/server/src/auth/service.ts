import type { PatchUserBody, Role, User } from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import { randomToken, sha256 } from '../crypto/secret.js';
import { errors } from '../http/errors.js';
import {
  dummyVerify,
  generatePassword,
  hashPassword,
  hashPasswordSync,
  verifyPassword,
} from './passwords.js';
import { LoginRateLimiter } from './rate-limit.js';

export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 60 * 1000;

export interface CreateUserInput {
  username: string;
  displayName: string;
  role: Role;
  password: string;
  mustChangePassword: boolean;
}

export interface AuthService {
  hasAnyUser(): boolean;
  /** conflict on duplicate username (case-insensitive) */
  createUser(i: CreateUserInput): User;
  /** Creates the first admin atomically; throws notFound if any user already exists. */
  createFirstAdmin(i: Omit<CreateUserInput, 'role' | 'mustChangePassword'>): Promise<User>;
  /** rate-limit + lockout; throws unauthorized / rateLimited; disabled → unauthorized */
  verifyLogin(username: string, password: string, ip: string): Promise<User>;
  /** returns raw token */
  createSession(userId: number, meta: { ip: string; userAgent: string }): string;
  /** updates last_seen_at (at most once/min); expires after 30 days idle; disabled user → null */
  resolveSession(rawToken: string): User | null;
  destroySession(rawToken: string): void;
  /** emits bus 'user:sessions-revoked' */
  revokeAll(userId: number): void;
  /** Deletes all of a user's sessions except `keepRawToken` (no bus event). */
  revokeOthers(userId: number, keepRawToken: string): void;
  changePassword(userId: number, current: string, next: string): Promise<void>;
  /** random 12-char, must_change_password=1, revokeAll */
  resetPassword(userId: number): Promise<string>;
  listUsers(): User[];
  /** cannot demote/disable last active admin → conflict; disabling emits 'user:disabled' + revokeAll */
  updateUser(id: number, patch: PatchUserBody, actorId: number): User;
  getUser(id: number): User | null;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  must_change_password: number;
  disabled_at: number | null;
  created_at: number;
}

export function rowToUser(r: UserRow): User {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    mustChangePassword: r.must_change_password === 1,
    disabled: r.disabled_at !== null,
    createdAt: r.created_at,
  };
}

export function createAuthService(
  ctx: Pick<AppContext, 'db' | 'bus'>,
  opts?: { limiter?: LoginRateLimiter; now?: () => number },
): AuthService {
  const { db, bus } = ctx;
  const now = opts?.now ?? Date.now;
  const limiter = opts?.limiter ?? new LoginRateLimiter(now);

  const q = {
    count: db.prepare('SELECT COUNT(*) AS n FROM users'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    byName: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
    list: db.prepare('SELECT * FROM users ORDER BY id'),
    insert: db.prepare(
      `INSERT INTO users (username, display_name, password_hash, role, must_change_password, disabled_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ),
    setPassword: db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?'),
    activeAdminsExcept: db.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL AND id != ?",
    ),
    sessionInsert: db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    sessionGet: db.prepare('SELECT user_id, last_seen_at FROM sessions WHERE token_hash = ?'),
    sessionTouch: db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?'),
    sessionDelete: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    sessionDeleteUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    sessionDeleteOthers: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
    sessionDeleteExpired: db.prepare('DELETE FROM sessions WHERE last_seen_at < ?'),
  };

  const getRow = (id: number) => q.byId.get(id) as UserRow | undefined;

  function insertUser(i: Omit<CreateUserInput, 'password'>, passwordHash: string): User {
    if (q.byName.get(i.username)) throw errors.conflict('Username already exists');
    try {
      const r = q.insert.run(i.username, i.displayName, passwordHash, i.role, i.mustChangePassword ? 1 : 0, now());
      return rowToUser(getRow(Number(r.lastInsertRowid))!);
    } catch (err) {
      if ((err as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')) {
        throw errors.conflict('Username already exists');
      }
      throw err;
    }
  }

  function revokeAll(userId: number): void {
    q.sessionDeleteUser.run(userId);
    bus.emit('user:sessions-revoked', userId);
  }

  // drop long-idle sessions on startup
  q.sessionDeleteExpired.run(now() - SESSION_IDLE_MS);

  return {
    hasAnyUser() {
      return (q.count.get() as { n: number }).n > 0;
    },

    createUser(i) {
      return insertUser(i, hashPasswordSync(i.password));
    },

    async createFirstAdmin(i) {
      if (this.hasAnyUser()) throw errors.notFound();
      const passwordHash = await hashPassword(i.password);
      // synchronous check + insert: no other request can interleave
      return db.transaction(() => {
        if (this.hasAnyUser()) throw errors.notFound();
        return insertUser({ ...i, role: 'admin', mustChangePassword: false }, passwordHash);
      })();
    },

    async verifyLogin(username, password, ip) {
      const c = limiter.check(username, ip);
      if (!c.ok) throw errors.rateLimited(c.retryAfterSec);
      const row = q.byName.get(username) as UserRow | undefined;
      let ok = false;
      if (row) ok = await verifyPassword(row.password_hash, password);
      else await dummyVerify(password);
      if (!row || !ok) {
        limiter.recordFailure(username, ip);
        throw errors.unauthorized('Invalid username or password');
      }
      if (row.disabled_at !== null) throw errors.unauthorized('Invalid username or password');
      limiter.recordSuccess(username);
      return rowToUser(row);
    },

    createSession(userId, meta) {
      const token = randomToken(32);
      const t = now();
      q.sessionInsert.run(sha256(token), userId, t, t, meta.userAgent.slice(0, 512), meta.ip);
      return token;
    },

    resolveSession(rawToken) {
      if (!rawToken) return null;
      const h = sha256(rawToken);
      const s = q.sessionGet.get(h) as { user_id: number; last_seen_at: number } | undefined;
      if (!s) return null;
      const t = now();
      if (t - s.last_seen_at > SESSION_IDLE_MS) {
        q.sessionDelete.run(h);
        return null;
      }
      const row = getRow(s.user_id);
      if (!row || row.disabled_at !== null) return null;
      if (t - s.last_seen_at >= LAST_SEEN_THROTTLE_MS) q.sessionTouch.run(t, h);
      return rowToUser(row);
    },

    destroySession(rawToken) {
      if (rawToken) q.sessionDelete.run(sha256(rawToken));
    },

    revokeAll,

    revokeOthers(userId, keepRawToken) {
      q.sessionDeleteOthers.run(userId, sha256(keepRawToken));
    },

    async changePassword(userId, current, next) {
      const row = getRow(userId);
      if (!row) throw errors.notFound('User');
      if (!(await verifyPassword(row.password_hash, current))) {
        throw errors.validation('Current password is incorrect');
      }
      if (current === next) throw errors.validation('New password must differ from the current password');
      q.setPassword.run(await hashPassword(next), 0, userId);
    },

    async resetPassword(userId) {
      if (!getRow(userId)) throw errors.notFound('User');
      const password = generatePassword(12);
      q.setPassword.run(await hashPassword(password), 1, userId);
      revokeAll(userId);
      return password;
    },

    listUsers() {
      return (q.list.all() as UserRow[]).map(rowToUser);
    },

    updateUser(id, patch, actorId) {
      const row = getRow(id);
      if (!row) throw errors.notFound('User');
      const isActiveAdmin = row.role === 'admin' && row.disabled_at === null;
      const demoting = patch.role === 'agent' && row.role === 'admin';
      const disabling = patch.disabled === true && row.disabled_at === null;
      if (disabling && id === actorId) throw errors.conflict('You cannot disable your own account');
      if (isActiveAdmin && (demoting || disabling)) {
        if ((q.activeAdminsExcept.get(id) as { n: number }).n === 0) {
          throw errors.conflict('Cannot demote or disable the last active admin');
        }
      }
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (patch.displayName !== undefined) {
        sets.push('display_name = ?');
        vals.push(patch.displayName);
      }
      if (patch.role !== undefined) {
        sets.push('role = ?');
        vals.push(patch.role);
      }
      if (patch.disabled !== undefined) {
        sets.push('disabled_at = ?');
        vals.push(patch.disabled ? (row.disabled_at ?? now()) : null);
      }
      if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
      if (disabling) {
        bus.emit('user:disabled', id);
        revokeAll(id);
      }
      return rowToUser(getRow(id)!);
    },

    getUser(id) {
      const row = getRow(id);
      return row ? rowToUser(row) : null;
    },
  };
}
