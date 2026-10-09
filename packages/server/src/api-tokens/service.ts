import type {
  ApiToken,
  CreateApiTokenBody,
  CreateApiTokenResponse,
  Role,
  User,
} from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import { getAuth } from '../auth/guards.js';
import { randomToken, sha256 } from '../crypto/secret.js';
import { audit } from '../db/audit.js';
import { errors } from '../http/errors.js';

/** Every token secret starts with this, so logs and support exports can redact it by shape. */
export const TOKEN_PREFIX = 'ezc_pat_';
/** `ezc_pat_` + 32 random bytes as base64url. */
const TOKEN_SHAPE = /^ezc_pat_[A-Za-z0-9_-]{43}$/;
/** Characters of the secret kept for display: the fixed prefix plus 4 random characters. */
const DISPLAY_CHARS = TOKEN_PREFIX.length + 4;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60_000;

/**
 * `inbox:read`: read chats, messages and stats. `ai:setup`: read, test and change the AI Sales
 * Agent's instructions, hand-off rules and business context text. Every admin token gets both.
 */
export type TokenScope = 'inbox:read' | 'ai:setup';
const KNOWN_SCOPES: ReadonlySet<string> = new Set<TokenScope>(['inbox:read', 'ai:setup']);
const NEW_TOKEN_SCOPES = 'inbox:read ai:setup';

export interface ApiPrincipal {
  tokenId: number;
  user: User;
  scopes: ReadonlySet<TokenScope>;
}

export type ResolveFailure =
  | 'malformed'
  | 'unknown'
  | 'revoked'
  | 'expired'
  | 'user_inactive'
  | 'not_admin'
  | 'must_change_password';

export type ResolveResult =
  { ok: true; principal: ApiPrincipal } | { ok: false; reason: ResolveFailure; tokenId?: number };

export interface ApiTokenService {
  /** Issues a token for an admin; the secret is in the response only. */
  create(userId: number, body: CreateApiTokenBody, ip: string): CreateApiTokenResponse;
  /** Tokens that are not revoked (expired ones included, so the admin can see them). */
  list(): ApiToken[];
  revoke(id: number, actorId: number, ip: string): void;
  /** Checks a bearer secret and its owner as they are now (role, disabled, password change). */
  resolve(secret: string): ResolveResult;
  /** Re-checks a resolved token mid-request (it may have been revoked or its owner demoted). */
  stillValid(tokenId: number): boolean;
  shutdown(): void;
}

interface TokenRow {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  prefix: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

/** Bearer secret from an Authorization header value, or null when it is not one of our tokens. */
export function parseBearer(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m && TOKEN_SHAPE.test(m[1]!) ? m[1]! : null;
}

export function createApiTokenService(
  ctx: AppContext,
  deps?: { now?: () => number },
): ApiTokenService {
  const now = deps?.now ?? Date.now;
  const auth = getAuth(ctx);
  const q = {
    insert: ctx.db.prepare(
      `INSERT INTO api_tokens (user_id, name, token_hash, prefix, created_at, expires_at, scopes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    byId: ctx.db.prepare('SELECT * FROM api_tokens WHERE id = ?'),
    byHash: ctx.db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?'),
    active: ctx.db.prepare(
      'SELECT * FROM api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC, id DESC',
    ),
    revoke: ctx.db.prepare(
      'UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    ),
    revokeForUser: ctx.db.prepare(
      'UPDATE api_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    ),
    touch: ctx.db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?'),
  };

  const toApiToken = (r: TokenRow): ApiToken => ({
    id: r.id,
    userId: r.user_id,
    userName: auth.getUser(r.user_id)?.displayName ?? '',
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
  });

  /** The token's owner when the token can be used right now, else why it cannot. */
  const check = (row: TokenRow, t: number): { user: User } | { reason: ResolveFailure } => {
    if (row.revoked_at !== null) return { reason: 'revoked' };
    if (row.expires_at !== null && row.expires_at <= t) return { reason: 'expired' };
    const user = auth.getUser(row.user_id);
    if (!user || user.disabled || user.kind === 'ai') return { reason: 'user_inactive' };
    if (user.role !== 'admin') return { reason: 'not_admin' };
    if (user.mustChangePassword) return { reason: 'must_change_password' };
    return { user };
  };

  // Tokens act with the owner's live role; revoking them on disable/demotion is housekeeping
  // (resolve() refuses them anyway) that also removes them from the admin list.
  const revokeForUser = (userId: number) => q.revokeForUser.run(now(), userId);
  const onDisabled = (userId: number) => revokeForUser(userId);
  const onRoleChanged = (userId: number, role: Role) => {
    if (role !== 'admin') revokeForUser(userId);
  };
  ctx.bus.on('user:disabled', onDisabled);
  ctx.bus.on('user:role-changed', onRoleChanged);

  return {
    create(userId, body, ip) {
      const owner = auth.getUser(userId);
      if (!owner || owner.role !== 'admin' || owner.disabled) throw errors.forbidden('Admin only');
      const secret = TOKEN_PREFIX + randomToken(32);
      const t = now();
      const expiresAt = body.expiresInDays === null ? null : t + body.expiresInDays * DAY_MS;
      const id = Number(
        q.insert.run(
          userId,
          body.name,
          sha256(secret),
          secret.slice(0, DISPLAY_CHARS),
          t,
          expiresAt,
          NEW_TOKEN_SCOPES,
        ).lastInsertRowid,
      );
      const token = toApiToken(q.byId.get(id) as TokenRow);
      audit(ctx.db, {
        userId,
        action: 'api_token.create',
        ip,
        meta: { tokenId: id, name: token.name, prefix: token.prefix, expiresAt },
      });
      return { token, secret };
    },

    list() {
      return (q.active.all() as TokenRow[]).map(toApiToken);
    },

    revoke(id, actorId, ip) {
      const row = q.byId.get(id) as TokenRow | undefined;
      if (!row || row.revoked_at !== null) throw errors.notFound('Token');
      q.revoke.run(now(), id);
      audit(ctx.db, {
        userId: actorId,
        action: 'api_token.revoke',
        ip,
        meta: { tokenId: id, name: row.name, prefix: row.prefix },
      });
    },

    resolve(secret) {
      if (!TOKEN_SHAPE.test(secret)) return { ok: false, reason: 'malformed' };
      const row = q.byHash.get(sha256(secret)) as TokenRow | undefined;
      if (!row) return { ok: false, reason: 'unknown' };
      const t = now();
      const result = check(row, t);
      if ('reason' in result) return { ok: false, reason: result.reason, tokenId: row.id };
      if (row.last_used_at === null || t - row.last_used_at >= TOUCH_INTERVAL_MS) {
        q.touch.run(t, row.id);
      }
      const scopes = new Set(
        row.scopes.split(' ').filter((s): s is TokenScope => KNOWN_SCOPES.has(s)),
      );
      return { ok: true, principal: { tokenId: row.id, user: result.user, scopes } };
    },

    stillValid(tokenId) {
      const row = q.byId.get(tokenId) as TokenRow | undefined;
      return row !== undefined && 'user' in check(row, now());
    },

    shutdown() {
      ctx.bus.off('user:disabled', onDisabled);
      ctx.bus.off('user:role-changed', onRoleChanged);
    },
  };
}
