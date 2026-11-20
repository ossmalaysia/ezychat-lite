import type {
  ApiToken,
  CreateApiTokenBody,
  CreateApiTokenResponse,
  Role,
  User,
} from '@ezychat/shared';
import type { AppContext } from '../context.js';
import { getAuth } from '../auth/guards.js';
import { randomToken, sha256 } from '../crypto/secret.js';
import { audit } from '../db/audit.js';
import { errors, HttpError } from '../http/errors.js';
import { canStartNewChats } from '../chats/new-chat.js';
import { mcpHolderRefusal, type McpHolderRefusal } from '../mcp/settings.js';

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
 * `inbox:send`: send text replies into existing chats; only when the admin ticks it at creation
 * or later by the token's owner in Settings (`updatePermissions`, audited; never through a token).
 * `inbox:send_new`: also start a chat with a number that is not in the inbox; only together with
 * `inbox:send`.
 */
export type TokenScope = 'inbox:read' | 'ai:setup' | 'inbox:send' | 'inbox:send_new';
const KNOWN_SCOPES: ReadonlySet<string> = new Set<TokenScope>([
  'inbox:read',
  'ai:setup',
  'inbox:send',
  'inbox:send_new',
]);
const NEW_TOKEN_SCOPES = 'inbox:read ai:setup';
/** A team member's token never holds `ai:setup` (AI setup is for admins only). */
const NEW_MEMBER_TOKEN_SCOPES = 'inbox:read';
/** Scopes a token can use for its owner's role, whatever is stored (defence in depth). */
const ROLE_SCOPES: Record<'admin' | 'agent', ReadonlySet<TokenScope>> = {
  admin: KNOWN_SCOPES as ReadonlySet<TokenScope>,
  agent: new Set<TokenScope>(['inbox:read', 'inbox:send', 'inbox:send_new']),
};
const SEND_SCOPE: TokenScope = 'inbox:send';
const SEND_NEW_SCOPE: TokenScope = 'inbox:send_new';

/** `base` plus the send scopes the body grants (`inbox:send_new` only together with `inbox:send`). */
function withSendScopes(
  base: string,
  body: { canSend?: boolean; canMessageNewNumbers?: boolean },
): string {
  if (body.canSend !== true) return base;
  return body.canMessageNewNumbers === true
    ? `${base} ${SEND_SCOPE} ${SEND_NEW_SCOPE}`
    : `${base} ${SEND_SCOPE}`;
}
const baseScopes = (role: Role) => (role === 'admin' ? NEW_TOKEN_SCOPES : NEW_MEMBER_TOKEN_SCOPES);

export interface ApiPrincipal {
  tokenId: number;
  user: User;
  scopes: ReadonlySet<TokenScope>;
}

export type ResolveFailure = 'malformed' | 'unknown' | 'revoked' | 'expired' | McpHolderRefusal;

export type ResolveResult =
  { ok: true; principal: ApiPrincipal } | { ok: false; reason: ResolveFailure; tokenId?: number };

export interface ApiTokenService {
  /**
   * Issues a token for an admin, or for a team member while members may connect (their token reaches
   * only what they can open and never gets `ai:setup`); the secret is in the response only.
   */
  create(
    userId: number,
    body: Pick<CreateApiTokenBody, 'name' | 'expiresInDays'> & {
      canSend?: boolean;
      canMessageNewNumbers?: boolean;
    },
    ip: string,
  ): CreateApiTokenResponse;
  /**
   * Issues a token to an AI assistant app the admin approved through the MCP sign-in (OAuth): never
   * expires, may not send (the owner can allow it later in Settings), and replaces the app's earlier
   * tokens for that admin so reconnecting never piles up tokens.
   */
  createForApp(
    userId: number,
    app: { clientId: string; name: string },
    ip: string,
  ): CreateApiTokenResponse;
  /**
   * Tokens that are not revoked (expired ones included, so the owner can see them): every token for an
   * admin, else only the viewer's own.
   */
  list(viewer: Pick<User, 'id' | 'role'>): ApiToken[];
  /** Admins revoke any token; anyone else only their own (another's is "not found"). */
  revoke(id: number, actor: Pick<User, 'id' | 'role'>, ip: string): void;
  /** Revokes every team member's token (the members switch went off); returns how many. */
  revokeMemberTokens(): number;
  /** Its owner changes whether a token may send (and message new numbers); takes effect on the next call. */
  updatePermissions(
    id: number,
    actorId: number,
    body: { canSend: boolean; canMessageNewNumbers: boolean },
    ip: string,
  ): ApiToken;
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
  oauth_client_id: string | null;
}

/** 403 for a person who may not hold a token right now; `code` tells the web why. */
const holderForbidden = (reason: McpHolderRefusal) =>
  reason === 'members_off'
    ? new HttpError(403, 'mcp_members_off', 'Your admin has not let members connect AI assistants')
    : errors.forbidden('You cannot connect an AI assistant');

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
      `INSERT INTO api_tokens
         (user_id, name, token_hash, prefix, created_at, expires_at, scopes, oauth_client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    revokeForApp: ctx.db.prepare(
      `UPDATE api_tokens SET revoked_at = ?
       WHERE user_id = ? AND oauth_client_id = ? AND revoked_at IS NULL`,
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
    revokeMembers: ctx.db.prepare(
      `UPDATE api_tokens SET revoked_at = ?
       WHERE revoked_at IS NULL
         AND user_id NOT IN (SELECT id FROM users WHERE role = 'admin' AND kind = 'human')`,
    ),
    touch: ctx.db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?'),
    setScopes: ctx.db.prepare(
      'UPDATE api_tokens SET scopes = ? WHERE id = ? AND revoked_at IS NULL',
    ),
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
    canSend: r.scopes.split(' ').includes(SEND_SCOPE),
    canMessageNewNumbers: r.scopes.split(' ').includes(SEND_NEW_SCOPE),
    connectedApp: r.oauth_client_id !== null,
    memberToken: auth.getUser(r.user_id)?.role !== 'admin',
  });

  /** The token's owner when the token can be used right now, else why it cannot. */
  const check = (row: TokenRow, t: number): { user: User } | { reason: ResolveFailure } => {
    if (row.revoked_at !== null) return { reason: 'revoked' };
    if (row.expires_at !== null && row.expires_at <= t) return { reason: 'expired' };
    const user = auth.getUser(row.user_id);
    const refused = mcpHolderRefusal(ctx, user);
    if (refused || !user) return { reason: refused ?? 'user_inactive' };
    return { user };
  };

  // Tokens act with the owner's live role and access. A disabled owner's tokens are refused anyway;
  // any role change (admin ↔ member) revokes them, so a token never silently gains or loses a whole
  // class of reach (a member's token becoming an admin's, or the reverse).
  const revokeForUser = (userId: number) => q.revokeForUser.run(now(), userId);
  const onDisabled = (userId: number) => revokeForUser(userId);
  const onRoleChanged = (userId: number, _role: Role) => revokeForUser(userId);
  ctx.bus.on('user:disabled', onDisabled);
  ctx.bus.on('user:role-changed', onRoleChanged);

  const issue = (
    userId: number,
    name: string,
    expiresInDays: number | null,
    scopes: string,
    oauthClientId: string | null,
    ip: string,
  ): CreateApiTokenResponse => {
    const owner = auth.getUser(userId);
    const refused = mcpHolderRefusal(ctx, owner);
    // A password change still to make does not block creating one (it blocks using it).
    if (refused && refused !== 'must_change_password') throw holderForbidden(refused);
    if (!owner) throw errors.forbidden('You cannot connect an AI assistant');
    // A member's token never holds AI setup; send scopes only as ticked, new numbers only when they
    // could start a new chat in the app.
    const allowed = ROLE_SCOPES[owner.role === 'admin' ? 'admin' : 'agent'];
    if (scopes.split(' ').some((s) => !allowed.has(s as TokenScope)))
      throw errors.forbidden('You cannot connect an AI assistant');
    if (scopes.split(' ').includes(SEND_NEW_SCOPE) && !canStartNewChats(ctx, owner))
      throw new HttpError(403, 'new_chat_not_allowed', 'You cannot start new chats');
    const secret = TOKEN_PREFIX + randomToken(32);
    const t = now();
    const expiresAt = expiresInDays === null ? null : t + expiresInDays * DAY_MS;
    const id = Number(
      q.insert.run(
        userId,
        name,
        sha256(secret),
        secret.slice(0, DISPLAY_CHARS),
        t,
        expiresAt,
        scopes,
        oauthClientId,
      ).lastInsertRowid,
    );
    const token = toApiToken(q.byId.get(id) as TokenRow);
    audit(ctx.db, {
      userId,
      action: 'api_token.create',
      ip,
      meta: {
        tokenId: id,
        name: token.name,
        prefix: token.prefix,
        expiresAt,
        canSend: token.canSend,
        canMessageNewNumbers: token.canMessageNewNumbers,
        ...(oauthClientId ? { oauthClientId } : {}),
      },
    });
    return { token, secret };
  };

  return {
    create(userId, body, ip) {
      const role = auth.getUser(userId)?.role ?? 'agent';
      return issue(
        userId,
        body.name,
        body.expiresInDays,
        withSendScopes(baseScopes(role), body),
        null,
        ip,
      );
    },

    createForApp(userId, app, ip) {
      return ctx.db.transaction(() => {
        q.revokeForApp.run(now(), userId, app.clientId);
        const role = auth.getUser(userId)?.role ?? 'agent';
        return issue(userId, app.name, null, baseScopes(role), app.clientId, ip);
      })();
    },

    list(viewer) {
      const rows = q.active.all() as TokenRow[];
      return (viewer.role === 'admin' ? rows : rows.filter((r) => r.user_id === viewer.id)).map(
        toApiToken,
      );
    },

    revokeMemberTokens() {
      return q.revokeMembers.run(now()).changes;
    },

    updatePermissions(id, actorId, body, ip) {
      const row = q.byId.get(id) as TokenRow | undefined;
      // Unknown and revoked tokens alike: a revoked row has a non-null revoked_at.
      if (row?.revoked_at !== null) throw errors.notFound('Token');
      // A token acts as its owner: only the owner may let it send in their name.
      if (row.user_id !== actorId)
        throw errors.forbidden('Only the owner of a token can change what it may do');
      if (row.expires_at !== null && row.expires_at <= now())
        throw errors.validation('This token has expired; create a new one');
      const owner = auth.getUser(actorId);
      const refused = mcpHolderRefusal(ctx, owner);
      if (refused && refused !== 'must_change_password') throw holderForbidden(refused);
      if (body.canMessageNewNumbers && owner && !canStartNewChats(ctx, owner))
        throw new HttpError(403, 'new_chat_not_allowed', 'You cannot start new chats');
      const before = toApiToken(row);
      const base = row.scopes
        .split(' ')
        .filter((s) => s !== SEND_SCOPE && s !== SEND_NEW_SCOPE)
        .join(' ');
      q.setScopes.run(withSendScopes(base, body), id);
      const token = toApiToken(q.byId.get(id) as TokenRow);
      audit(ctx.db, {
        userId: actorId,
        action: 'api_token.update',
        ip,
        meta: {
          tokenId: id,
          name: row.name,
          prefix: row.prefix,
          before: { canSend: before.canSend, canMessageNewNumbers: before.canMessageNewNumbers },
          after: { canSend: token.canSend, canMessageNewNumbers: token.canMessageNewNumbers },
        },
      });
      return token;
    },

    revoke(id, actor, ip) {
      const row = q.byId.get(id) as TokenRow | undefined;
      // Someone else's token reads as missing for a member (never a hint it exists).
      if (!row || row.revoked_at !== null || (actor.role !== 'admin' && row.user_id !== actor.id))
        throw errors.notFound('Token');
      q.revoke.run(now(), id);
      audit(ctx.db, {
        userId: actor.id,
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
      // Only the scopes the owner's live role may use, whatever is stored.
      const allowed = ROLE_SCOPES[result.user.role === 'admin' ? 'admin' : 'agent'];
      const scopes = new Set(
        row.scopes
          .split(' ')
          .filter((s): s is TokenScope => KNOWN_SCOPES.has(s) && allowed.has(s as TokenScope)),
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
