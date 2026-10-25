import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { OAuthAuthorizeParams, User } from '@ezychat/shared';
import type { AppContext } from '../context.js';
import { getApiTokens } from '../api-tokens/index.js';
import { randomToken, sha256 } from '../crypto/secret.js';
import { audit } from '../db/audit.js';
import { isHttps } from '../http/client-ip.js';
import { errors } from '../http/errors.js';
import { MCP_PATH } from './settings.js';

declare module '../context.js' {
  interface Services {
    mcpOAuth?: McpOAuth;
  }
}

/**
 * MCP sign-in (OAuth 2.1, the MCP authorization spec): an AI assistant app registers itself
 * (RFC 7591), sends the admin's browser to the approval page (/oauth/authorize, PKCE S256 only),
 * and swaps the one-time code for an ordinary personal access token (`createForApp`). The token is
 * what /mcp accepts; it shows in Settings → Integrations and is revoked there. No refresh tokens:
 * the access token lives until it is revoked, like a token made in Settings.
 */

export const AUTHORIZE_PATH = '/oauth/authorize';
export const TOKEN_PATH = `${MCP_PATH}/oauth/token`;
export const REGISTER_PATH = `${MCP_PATH}/oauth/register`;

const CODE_TTL_MS = 5 * 60_000;
const MAX_PENDING_CODES = 200;
/** Registered apps that never got a token are removed after a day; at most this many apps exist. */
const UNUSED_CLIENT_MS = 24 * 60 * 60 * 1000;
const MAX_CLIENTS = 200;
const MAX_REDIRECT_URIS = 10;
const CLIENT_NAME_CHARS = 64;
const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'] as const;
type AuthMethod = (typeof AUTH_METHODS)[number];
/** Schemes an app may never be sent back to (RFC 8252 lets native apps use their own schemes). */
const BLOCKED_SCHEMES = new Set([
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'blob:',
  'about:',
  'ws:',
  'wss:',
  'ftp:',
]);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PKCE = /^[A-Za-z0-9._~-]{43,128}$/;

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  authMethod: AuthMethod;
  secretHash: string | null;
}

interface ClientRow {
  id: string;
  name: string;
  redirect_uris: string;
  auth_method: string;
  secret_hash: string | null;
  created_at: number;
  last_used_at: number | null;
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
  userId: number;
  expiresAt: number;
}

/** An OAuth error for the app (token and registration endpoints): `{ error, error_description }`. */
export class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    description: string,
  ) {
    super(description);
  }
  body() {
    return { error: this.error, error_description: this.message };
  }
}

/** `https://<host>` through the tunnel, `http://<host>` on this computer (Host already allowlisted). */
export function issuerFor(req: FastifyRequest): string {
  const raw = `${isHttps(req) ? 'https' : 'http'}://${req.headers.host ?? ''}`;
  try {
    // origin drops a default port and lowercases, so it compares with a client's URL origin.
    return new URL(raw).origin;
  } catch {
    return raw.toLowerCase();
  }
}

/** An address an app may be sent back to: https, http on loopback, or the app's own scheme. */
export function validRedirectUri(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return u.hostname !== '';
  if (u.protocol === 'http:') return LOOPBACK_HOSTS.has(u.hostname);
  return !BLOCKED_SCHEMES.has(u.protocol);
}

/** What the admin sees as "returns to": the host for web addresses, scheme + host for an app. */
export function redirectHost(raw: string): string {
  const u = new URL(raw);
  return u.protocol === 'https:' || u.protocol === 'http:' ? u.host : `${u.protocol}//${u.host}`;
}

/** A display name from the app's registration: no control characters, at most 64 characters. */
function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CLIENT_NAME_CHARS);
}

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

function sameSecret(secret: string, hash: string): boolean {
  const a = Buffer.from(sha256(secret), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The `resource` an app asks for must be this server's MCP address (RFC 8707). */
function checkResource(resource: string | undefined, issuer: string): boolean {
  if (resource === undefined) return true;
  try {
    const u = new URL(resource);
    return u.origin === issuer && ['/', MCP_PATH, `${MCP_PATH}/`].includes(u.pathname);
  } catch {
    return false;
  }
}

export interface McpOAuth {
  authorizationServerMetadata(issuer: string): Record<string, unknown>;
  protectedResourceMetadata(issuer: string): Record<string, unknown>;
  /** RFC 7591 registration; throws OAuthError for bad metadata or too many apps. */
  register(body: unknown): Record<string, unknown>;
  /** Checks an authorization request for the approval page; throws a 400 HttpError when invalid. */
  check(params: OAuthAuthorizeParams, issuer: string): { client: OAuthClient; redirectUri: string };
  /** The admin approved or denied: the address to send the browser back to. */
  decide(
    params: OAuthAuthorizeParams,
    issuer: string,
    user: User,
    approve: boolean,
    ip: string,
  ): string;
  /** Token endpoint: a one-time code for an access token; throws OAuthError. */
  exchange(
    form: Record<string, string | undefined>,
    authorization: string | undefined,
    issuer: string,
    ip: string,
  ): Record<string, unknown>;
}

export function getMcpOAuth(ctx: AppContext): McpOAuth {
  ctx.services.mcpOAuth ??= createMcpOAuth(ctx);
  return ctx.services.mcpOAuth;
}

export function createMcpOAuth(ctx: AppContext, deps?: { now?: () => number }): McpOAuth {
  const now = deps?.now ?? Date.now;
  const log = ctx.log.child({ mod: 'mcp' });
  const codes = new Map<string, PendingCode>();
  const q = {
    insert: ctx.db.prepare(
      `INSERT INTO oauth_clients (id, name, redirect_uris, auth_method, secret_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    byId: ctx.db.prepare('SELECT * FROM oauth_clients WHERE id = ?'),
    count: ctx.db.prepare('SELECT COUNT(*) FROM oauth_clients').pluck(),
    pruneUnused: ctx.db.prepare(
      'DELETE FROM oauth_clients WHERE last_used_at IS NULL AND created_at < ?',
    ),
    touch: ctx.db.prepare('UPDATE oauth_clients SET last_used_at = ? WHERE id = ?'),
  };

  const getClient = (id: string): OAuthClient | null => {
    const row = q.byId.get(id) as ClientRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      redirectUris: JSON.parse(row.redirect_uris) as string[],
      authMethod: row.auth_method as AuthMethod,
      secretHash: row.secret_hash,
    };
  };

  const dropExpiredCodes = (t: number) => {
    for (const [k, v] of codes) if (v.expiresAt <= t) codes.delete(k);
  };

  const check: McpOAuth['check'] = (params, issuer) => {
    const client = getClient(params.client_id);
    if (!client)
      throw errors.validation('This app is not registered here. Add the connector again.');
    let redirectUri = params.redirect_uri;
    if (redirectUri === undefined && client.redirectUris.length === 1)
      redirectUri = client.redirectUris[0];
    if (redirectUri === undefined || !client.redirectUris.includes(redirectUri)) {
      throw errors.validation('The return address does not match what the app registered.');
    }
    if (params.response_type !== 'code') throw errors.validation('Unsupported response_type.');
    if (params.code_challenge_method !== 'S256' || !PKCE.test(params.code_challenge ?? '')) {
      throw errors.validation('The app must use PKCE with S256.');
    }
    if (!checkResource(params.resource, issuer)) {
      throw errors.validation('The app asked for a different server.');
    }
    return { client, redirectUri };
  };

  return {
    authorizationServerMetadata(issuer) {
      return {
        issuer,
        authorization_endpoint: `${issuer}${AUTHORIZE_PATH}`,
        token_endpoint: `${issuer}${TOKEN_PATH}`,
        registration_endpoint: `${issuer}${REGISTER_PATH}`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: [...AUTH_METHODS],
      };
    },

    protectedResourceMetadata(issuer) {
      return {
        resource: `${issuer}${MCP_PATH}`,
        authorization_servers: [issuer],
        bearer_methods_supported: ['header'],
        resource_name: 'EzyChat',
      };
    },

    register(body) {
      const b = (body ?? {}) as Record<string, unknown>;
      const uris = b.redirect_uris;
      if (
        !Array.isArray(uris) ||
        uris.length === 0 ||
        uris.length > MAX_REDIRECT_URIS ||
        !uris.every((u) => typeof u === 'string' && u.length <= 2000 && validRedirectUri(u))
      ) {
        throw new OAuthError(
          400,
          'invalid_redirect_uri',
          'redirect_uris must be https, loopback http or an app scheme',
        );
      }
      const requested = b.token_endpoint_auth_method ?? 'client_secret_basic';
      if (
        typeof requested !== 'string' ||
        !(AUTH_METHODS as readonly string[]).includes(requested)
      ) {
        throw new OAuthError(
          400,
          'invalid_client_metadata',
          'Unsupported token_endpoint_auth_method',
        );
      }
      const grants = b.grant_types;
      if (
        grants !== undefined &&
        (!Array.isArray(grants) || !grants.includes('authorization_code'))
      ) {
        throw new OAuthError(
          400,
          'invalid_client_metadata',
          'grant_types must include authorization_code',
        );
      }
      const t = now();
      q.pruneUnused.run(t - UNUSED_CLIENT_MS);
      if ((q.count.get() as number) >= MAX_CLIENTS) {
        throw new OAuthError(
          400,
          'invalid_client_metadata',
          'Too many registered apps; try again tomorrow',
        );
      }
      const method = requested as AuthMethod;
      const id = `ezc_app_${randomToken(16)}`;
      const secret = method === 'none' ? null : `ezc_app_secret_${randomToken(32)}`;
      const name = cleanName(b.client_name);
      q.insert.run(id, name, JSON.stringify(uris), method, secret ? sha256(secret) : null, t);
      log.info(
        { clientId: id, method, redirectHosts: (uris as string[]).map(redirectHost) },
        'mcp app registered',
      );
      return {
        client_id: id,
        client_id_issued_at: Math.floor(t / 1000),
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_name: name || undefined,
        redirect_uris: uris,
        token_endpoint_auth_method: method,
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };
    },

    check,

    decide(params, issuer, user, approve, ip) {
      const { client, redirectUri } = check(params, issuer);
      const target = new URL(redirectUri);
      const host = redirectHost(redirectUri);
      audit(ctx.db, {
        userId: user.id,
        action: approve ? 'mcp.app_approve' : 'mcp.app_deny',
        ip,
        meta: { clientId: client.id, redirectHost: host },
      });
      if (approve) {
        const t = now();
        dropExpiredCodes(t);
        while (codes.size >= MAX_PENDING_CODES) codes.delete(codes.keys().next().value!);
        const code = randomToken(32);
        codes.set(sha256(code), {
          clientId: client.id,
          redirectUri,
          challenge: params.code_challenge!,
          userId: user.id,
          expiresAt: t + CODE_TTL_MS,
        });
        target.searchParams.set('code', code);
      } else {
        target.searchParams.set('error', 'access_denied');
      }
      if (params.state !== undefined) target.searchParams.set('state', params.state);
      target.searchParams.set('iss', issuer);
      return target.toString();
    },

    exchange(form, authorization, issuer, ip) {
      if (form.grant_type !== 'authorization_code') {
        throw new OAuthError(400, 'unsupported_grant_type', 'Only authorization_code is supported');
      }
      // Client authentication: HTTP Basic (client_secret_basic) or the form (post / none).
      let clientId = form.client_id;
      let secret = form.client_secret;
      const basic = /^Basic\s+(\S+)$/i.exec(authorization ?? '');
      if (basic) {
        const [id, pass] = Buffer.from(basic[1]!, 'base64').toString('utf8').split(':');
        try {
          clientId = decodeURIComponent(id ?? '');
          secret = decodeURIComponent(pass ?? '');
        } catch {
          throw new OAuthError(401, 'invalid_client', 'Malformed client credentials');
        }
      }
      const client = clientId ? getClient(clientId) : null;
      if (!client) throw new OAuthError(401, 'invalid_client', 'Unknown client');
      if (client.secretHash !== null && !(secret && sameSecret(secret, client.secretHash))) {
        throw new OAuthError(401, 'invalid_client', 'Client authentication failed');
      }

      const code = form.code ?? '';
      const key = sha256(code);
      const pending = codes.get(key);
      codes.delete(key); // one try per code, right or wrong
      const t = now();
      if (!pending || pending.expiresAt <= t || pending.clientId !== client.id) {
        throw new OAuthError(400, 'invalid_grant', 'The code is invalid or expired');
      }
      if (form.redirect_uri !== undefined && form.redirect_uri !== pending.redirectUri) {
        throw new OAuthError(400, 'invalid_grant', 'redirect_uri does not match');
      }
      const verifier = form.code_verifier ?? '';
      if (!PKCE.test(verifier) || s256(verifier) !== pending.challenge) {
        throw new OAuthError(400, 'invalid_grant', 'PKCE verification failed');
      }
      if (!checkResource(form.resource, issuer)) {
        throw new OAuthError(400, 'invalid_target', 'Unknown resource');
      }

      let issued;
      try {
        issued = getApiTokens(ctx).createForApp(
          pending.userId,
          { clientId: client.id, name: client.name || redirectHost(pending.redirectUri) },
          ip,
        );
      } catch {
        // The approving admin was disabled or demoted after approving.
        throw new OAuthError(400, 'invalid_grant', 'The approving admin can no longer sign in');
      }
      q.touch.run(t, client.id);
      log.info({ clientId: client.id, tokenId: issued.token.id }, 'mcp app token issued');
      return { access_token: issued.secret, token_type: 'Bearer' };
    },
  };
}
