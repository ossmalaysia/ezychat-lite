// A tiny in-memory OAuth 2.1 authorization server for one partner MCP test endpoint: RFC 8414
// metadata, optional RFC 7591 dynamic client registration, pre-registered clients, authorization
// code + PKCE (S256 only), a consent page with Allow / Cancel, refresh tokens with rotation,
// RFC 7009 revocation and short-lived access tokens bound to the resource (RFC 8707).
// TEST ONLY: ported from the Enterprise connector-testkit (packages/connector-testkit/src/oauth.ts).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const OAUTH_SCOPES = ['invoices.read', 'stock.read', 'quotes.write'];
const DEFAULT_SCOPES = ['invoices.read', 'stock.read'];
const SCOPE_LABELS = {
  'invoices.read': 'Read your invoices',
  'stock.read': 'Read your stock levels',
  'quotes.write': 'Create quotations',
};
const MAX_CLIENTS = 500;
const MAX_PENDING = 500;
const random = () => randomBytes(24).toString('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const escapeHtml = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const isLoopbackUrl = (u) => ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);

/** Redirect URIs a client may register: https anywhere, http only on loopback, no fragment. */
function validRedirectUri(value) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const u = new URL(value);
    if (u.hash) return false;
    return u.protocol === 'https:' || (u.protocol === 'http:' && isLoopbackUrl(u));
  } catch {
    return false;
  }
}

export function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...extra,
  });
  res.end(JSON.stringify(body));
}

/** HTML with a strict CSP; the form may lead to the (checked) redirect address's origin. */
function sendHtml(res, status, html, formTargets = []) {
  const formAction = ["'self'", ...formTargets].join(' ');
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}`,
    'x-frame-options': 'DENY',
  });
  res.end(html);
}

function redirect(res, to) {
  res.writeHead(302, { location: to.toString(), 'cache-control': 'no-store' });
  res.end();
}

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#1d2433;margin:0;padding:16px}
main{max-width:420px;margin:40px auto;background:#fff;border:1px solid #dde1e7;border-radius:12px;padding:24px}
h1{font-size:20px;margin:0 0 8px}p{line-height:1.5}ul{padding-left:20px}
.row{display:flex;gap:8px;margin-top:20px}button{flex:1;font-size:16px;padding:10px;border-radius:8px;border:1px solid #c5cbd5;background:#fff;cursor:pointer}
button[value=allow]{background:#1d6f42;color:#fff;border-color:#1d6f42}.note{color:#5b6475;font-size:13px}
</style></head><body><main>${body}</main></body></html>`;

export class OAuthTestServer {
  /**
   * @param {{ segment: string, dynamicRegistration: boolean, accessTokenTtlSeconds: number,
   *   resourceName: string, clients?: Array<{ clientId: string, clientSecret?: string,
   *   redirectUris?: string[] }> }} options
   */
  constructor(options) {
    this.options = options;
    this.clients = new Map();
    this.pending = new Map();
    this.codes = new Map();
    this.access = new Map();
    this.refresh = new Map();
    this.revoked = 0;
    this.origin = '';
    for (const c of options.clients ?? [])
      this.clients.set(c.clientId, {
        clientId: c.clientId,
        clientSecret: c.clientSecret,
        redirectUris: c.redirectUris,
        clientName: 'EzyChat (pre-registered test client)',
      });
  }

  get issuer() {
    return `${this.origin}/${this.options.segment}`;
  }
  get resource() {
    return `${this.origin}/${this.options.segment}/mcp`;
  }
  get resourceMetadataUrl() {
    return `${this.origin}/.well-known/oauth-protected-resource/${this.options.segment}/mcp`;
  }

  protectedResourceMetadata() {
    return {
      resource: this.resource,
      authorization_servers: [this.issuer],
      scopes_supported: [...OAUTH_SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: this.options.resourceName,
    };
  }

  authorizationServerMetadata() {
    const dcr = this.options.dynamicRegistration;
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      revocation_endpoint: `${this.issuer}/revoke`,
      ...(dcr ? { registration_endpoint: `${this.issuer}/register` } : {}),
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: dcr
        ? ['none', 'client_secret_post', 'client_secret_basic']
        : ['client_secret_post', 'client_secret_basic'],
      scopes_supported: [...OAUTH_SCOPES],
      authorization_response_iss_parameter_supported: true,
    };
  }

  /** The WWW-Authenticate value for a 401 from the MCP endpoint. */
  challenge(tokenPresented) {
    const err = tokenPresented ? ', error="invalid_token"' : '';
    return `Bearer resource_metadata="${this.resourceMetadataUrl}"${err}`;
  }

  verifyAccessToken(token) {
    const grant = this.access.get(token);
    if (!grant) return false;
    if (grant.expiresAt <= Date.now()) {
      this.access.delete(token);
      return false;
    }
    return true;
  }

  /** Access tokens stop working; refresh tokens still do (the app must refresh). */
  expireAccessTokens() {
    this.access.clear();
  }

  /** Forget every token and code: the next call needs a new sign-in. */
  revokeAll() {
    this.access.clear();
    this.refresh.clear();
    this.codes.clear();
    this.pending.clear();
  }

  /** Handles /<segment>/{authorize,token,register,revoke}; returns false for other paths. */
  async handle(req, res, url, readBody) {
    const base = `/${this.options.segment}`;
    if (url.pathname === `${base}/authorize`) {
      if (req.method === 'GET') this.authorizeGet(res, url);
      else if (req.method === 'POST')
        this.authorizePost(res, new URLSearchParams(await readBody()));
      else sendJson(res, 405, { error: 'method_not_allowed' }, { allow: 'GET, POST' });
      return true;
    }
    if (url.pathname === `${base}/token`) {
      if (req.method !== 'POST')
        sendJson(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' });
      else this.token(req, res, new URLSearchParams(await readBody()));
      return true;
    }
    if (url.pathname === `${base}/revoke` && req.method === 'POST') {
      const form = new URLSearchParams(await readBody());
      const token = form.get('token') ?? '';
      if (this.refresh.delete(token) || this.access.delete(token)) this.revoked++;
      sendJson(res, 200, {});
      return true;
    }
    if (url.pathname === `${base}/register` && this.options.dynamicRegistration) {
      if (req.method !== 'POST')
        sendJson(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' });
      else this.register(res, await readBody());
      return true;
    }
    return false;
  }

  register(res, raw) {
    let meta;
    try {
      meta = JSON.parse(raw);
      if (!meta || typeof meta !== 'object' || Array.isArray(meta))
        throw new Error('not an object');
    } catch {
      return sendJson(res, 400, { error: 'invalid_client_metadata' });
    }
    const uris = meta.redirect_uris;
    if (
      !Array.isArray(uris) ||
      uris.length === 0 ||
      uris.length > 10 ||
      !uris.every(validRedirectUri)
    )
      return sendJson(res, 400, { error: 'invalid_redirect_uri' });
    const method = meta.token_endpoint_auth_method ?? 'client_secret_basic';
    if (!['none', 'client_secret_basic', 'client_secret_post'].includes(method))
      return sendJson(res, 400, { error: 'invalid_client_metadata' });
    if (this.clients.size >= MAX_CLIENTS)
      return sendJson(res, 400, { error: 'invalid_client_metadata' });
    const clientName =
      typeof meta.client_name === 'string' && meta.client_name.trim()
        ? meta.client_name.trim().slice(0, 100)
        : 'Unnamed app';
    const client = {
      clientId: `dcr_${random()}`,
      clientSecret: method === 'none' ? undefined : random(),
      redirectUris: uris,
      clientName,
    };
    this.clients.set(client.clientId, client);
    sendJson(res, 201, {
      client_id: client.clientId,
      ...(client.clientSecret
        ? { client_secret: client.clientSecret, client_secret_expires_at: 0 }
        : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  }

  redirectAllowed(client, uri) {
    if (client.redirectUris) return client.redirectUris.includes(uri);
    try {
      const u = new URL(uri);
      return !u.hash && (u.protocol === 'http:' || u.protocol === 'https:') && isLoopbackUrl(u);
    } catch {
      return false;
    }
  }

  errorPage(res, message) {
    sendHtml(
      res,
      400,
      page('Sign-in problem', `<h1>Sign-in problem</h1><p>${escapeHtml(message)}</p>`),
    );
  }

  authorizeGet(res, url) {
    const q = url.searchParams;
    const client = this.clients.get(q.get('client_id') ?? '');
    if (!client) return this.errorPage(res, 'Unknown client_id.');
    const redirectUri = q.get('redirect_uri') ?? '';
    if (!this.redirectAllowed(client, redirectUri))
      return this.errorPage(res, 'This redirect address is not registered for the app.');
    const back = (error) => {
      const to = new URL(redirectUri);
      to.searchParams.set('error', error);
      const state = q.get('state');
      if (state) to.searchParams.set('state', state);
      to.searchParams.set('iss', this.issuer);
      redirect(res, to);
    };
    if (q.get('response_type') !== 'code') return back('unsupported_response_type');
    const challenge = q.get('code_challenge') ?? '';
    if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge))
      return back('invalid_request');
    const resource = q.get('resource');
    if (resource !== null && resource !== this.resource) return back('invalid_target');
    const requested = (q.get('scope') ?? '').split(' ').filter(Boolean);
    if (requested.some((s) => !OAUTH_SCOPES.includes(s))) return back('invalid_scope');
    if (this.pending.size >= MAX_PENDING) this.pending.clear();
    const requestId = random();
    const scope = requested.length ? requested : DEFAULT_SCOPES;
    this.pending.set(requestId, {
      clientId: client.clientId,
      redirectUri,
      state: q.get('state') ?? undefined,
      codeChallenge: challenge,
      scope,
      expiresAt: Date.now() + 10 * 60_000,
    });
    const items = scope.map((s) => `<li>${escapeHtml(SCOPE_LABELS[s] ?? s)}</li>`).join('');
    sendHtml(
      res,
      200,
      page(
        'Allow access?',
        `<h1>Allow ${escapeHtml(client.clientName)} to use ${escapeHtml(this.options.resourceName)}?</h1>
<p>It will be able to:</p><ul>${items}</ul>
<form method="post" action="${escapeHtml(`/${this.options.segment}/authorize`)}">
<input type="hidden" name="request_id" value="${requestId}">
<div class="row"><button type="submit" name="decision" value="cancel">Cancel</button>
<button type="submit" name="decision" value="allow">Allow</button></div></form>
<p class="note">Test sign-in page of the EzyChat partner MCP test server. Demo data only.</p>`,
      ),
      [new URL(redirectUri).origin],
    );
  }

  authorizePost(res, form) {
    const id = form.get('request_id') ?? '';
    const p = this.pending.get(id);
    this.pending.delete(id);
    if (!p || p.expiresAt <= Date.now())
      return this.errorPage(res, 'This sign-in request has expired. Start again from the app.');
    const to = new URL(p.redirectUri);
    if (p.state) to.searchParams.set('state', p.state);
    to.searchParams.set('iss', this.issuer);
    if (form.get('decision') !== 'allow') {
      to.searchParams.set('error', 'access_denied');
      return redirect(res, to);
    }
    const code = random();
    this.codes.set(code, {
      clientId: p.clientId,
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
      scope: p.scope,
      expiresAt: Date.now() + 2 * 60_000,
    });
    to.searchParams.set('code', code);
    redirect(res, to);
  }

  /** RFC 6749 section 2.3 client authentication (Basic, POST body, or none for public clients). */
  authenticateClient(req, form) {
    const header = req.headers.authorization ?? '';
    let id = form.get('client_id') ?? '';
    let secret = form.get('client_secret') ?? undefined;
    if (/^Basic\s+/i.test(header)) {
      const decoded = Buffer.from(header.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i < 0) return undefined;
      try {
        id = decodeURIComponent(decoded.slice(0, i));
        secret = decodeURIComponent(decoded.slice(i + 1));
      } catch {
        return undefined;
      }
    }
    const client = this.clients.get(id);
    if (!client) return undefined;
    if (!client.clientSecret) return secret === undefined ? client : undefined;
    return secret !== undefined && safeEqual(secret, client.clientSecret) ? client : undefined;
  }

  issue(res, clientId, scope) {
    const accessToken = `at_${random()}`;
    const refreshToken = `rt_${random()}`;
    const ttl = this.options.accessTokenTtlSeconds;
    this.access.set(accessToken, { clientId, scope, expiresAt: Date.now() + ttl * 1000 });
    this.refresh.set(refreshToken, { clientId, scope, expiresAt: Date.now() + 24 * 3600_000 });
    sendJson(res, 200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ttl,
      refresh_token: refreshToken,
      scope: scope.join(' '),
    });
  }

  token(req, res, form) {
    const client = this.authenticateClient(req, form);
    if (!client)
      return sendJson(res, 401, { error: 'invalid_client' }, { 'www-authenticate': 'Basic' });
    const resource = form.get('resource');
    if (resource !== null && resource !== this.resource)
      return sendJson(res, 400, { error: 'invalid_target' });
    const grantType = form.get('grant_type');
    if (grantType === 'authorization_code') {
      const code = form.get('code') ?? '';
      const grant = this.codes.get(code);
      this.codes.delete(code);
      if (!grant || grant.expiresAt <= Date.now() || grant.clientId !== client.clientId)
        return sendJson(res, 400, { error: 'invalid_grant' });
      if (form.get('redirect_uri') !== grant.redirectUri)
        return sendJson(res, 400, { error: 'invalid_grant' });
      const verifier = form.get('code_verifier') ?? '';
      const expected = createHash('sha256').update(verifier).digest('base64url');
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !safeEqual(expected, grant.codeChallenge))
        return sendJson(res, 400, { error: 'invalid_grant' });
      return this.issue(res, client.clientId, grant.scope);
    }
    if (grantType === 'refresh_token') {
      const rt = form.get('refresh_token') ?? '';
      const grant = this.refresh.get(rt);
      this.refresh.delete(rt);
      if (!grant || grant.expiresAt <= Date.now() || grant.clientId !== client.clientId)
        return sendJson(res, 400, { error: 'invalid_grant' });
      return this.issue(res, client.clientId, grant.scope);
    }
    sendJson(res, 400, { error: 'unsupported_grant_type' });
  }
}
