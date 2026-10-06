/**
 * EXPERIMENTAL (owner-approved spike): ChatGPT sign-in without the Codex binary.
 *
 * Reimplements the Codex CLI OAuth flow (authorization code + PKCE S256) the way OpenClaw / pi-ai
 * does. It borrows the public Codex CLI client id and talks to non-public endpoints, so it may stop
 * working at any time. Protocol facts and their sources are in docs/ai-chatgpt-protocol.md.
 *
 * Never log tokens, codes, state, verifiers or full URLs: they are credentials.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';

export const CHATGPT_OAUTH = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  callbackHost: '127.0.0.1',
  callbackPort: 1455,
  callbackPath: '/auth/callback',
  redirectUri: 'http://localhost:1455/auth/callback',
  scope: 'openid profile email offline_access',
  originator: 'codex_cli_rs',
} as const;

export const LOGIN_TIMEOUT_MS = 5 * 60_000;
const AUTH_CLAIM = 'https://api.openai.com/auth';
const PROFILE_CLAIM = 'https://api.openai.com/profile';

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function createState(): string {
  return randomBytes(16).toString('hex');
}

export function stateMatches(expected: string, received: string | null): boolean {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ParsedCallback {
  state: string;
  code: string | null;
  error: string | null;
}

/** Accepts only the sign-in redirect address (pasted by an admin on another computer). */
export function parseCallbackUrl(raw: string): ParsedCallback | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== String(CHATGPT_OAUTH.callbackPort) ||
    url.pathname !== CHATGPT_OAUTH.callbackPath ||
    url.username ||
    url.password
  )
    return null;
  const state = url.searchParams.get('state');
  if (!state) return null;
  return { state, code: url.searchParams.get('code'), error: url.searchParams.get('error') };
}

export function buildAuthorizeUrl(challenge: string, state: string): string {
  const url = new URL(CHATGPT_OAUTH.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CHATGPT_OAUTH.clientId);
  url.searchParams.set('redirect_uri', CHATGPT_OAUTH.redirectUri);
  url.searchParams.set('scope', CHATGPT_OAUTH.scope);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', CHATGPT_OAUTH.originator);
  return url.toString();
}

export function decodeJwtPayload(token: string | undefined | null): Record<string, unknown> | null {
  const parts = token?.split('.');
  if (!parts || parts.length !== 3) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const claim = (payload: Record<string, unknown> | null, name: string) => {
  const value = payload?.[name];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
};
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** chatgpt_account_id from the access token (as OpenClaw does), else from the id token. */
export function accountIdFromTokens(accessToken: string, idToken?: string | null): string | null {
  for (const token of [accessToken, idToken]) {
    const id = text(claim(decodeJwtPayload(token), AUTH_CLAIM)?.chatgpt_account_id);
    if (id) return id;
  }
  return null;
}

export function emailFromTokens(accessToken: string, idToken?: string | null): string | null {
  return (
    text(claim(decodeJwtPayload(accessToken), PROFILE_CLAIM)?.email) ??
    text(decodeJwtPayload(idToken)?.email)
  );
}

export interface ChatGptTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
  accountId: string;
  email: string | null;
  /** Epoch ms. */
  expiresAt: number;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

type FetchFn = typeof fetch;

async function tokenRequest(
  body: URLSearchParams,
  fetchImpl: FetchFn,
  previous?: Pick<ChatGptTokens, 'refreshToken' | 'idToken'>,
): Promise<ChatGptTokens> {
  let response: Response;
  try {
    response = await fetchImpl(CHATGPT_OAUTH.tokenUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new OAuthError('Cannot reach ChatGPT sign-in. Check the internet connection.');
  }
  if (!response.ok) {
    // Never surface the body: token endpoint errors can echo grant data.
    await response.body?.cancel().catch(() => {});
    throw new OAuthError('ChatGPT sign-in was rejected. Sign in again.', response.status);
  }
  let json: Record<string, unknown>;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new OAuthError('ChatGPT sign-in returned an invalid response.');
  }
  const accessToken = text(json.access_token);
  const refreshToken = text(json.refresh_token) ?? previous?.refreshToken ?? null;
  const idToken = text(json.id_token) ?? previous?.idToken ?? null;
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : null;
  if (!accessToken || !refreshToken)
    throw new OAuthError('ChatGPT sign-in returned an incomplete response.');
  const accountId = accountIdFromTokens(accessToken, idToken);
  if (!accountId) throw new OAuthError('ChatGPT sign-in did not include a ChatGPT account.');
  const exp = decodeJwtPayload(accessToken)?.exp;
  const expiresAt =
    expiresIn !== null
      ? Date.now() + expiresIn * 1000
      : typeof exp === 'number'
        ? exp * 1000
        : Date.now() + 3600_000;
  return {
    accessToken,
    refreshToken,
    idToken,
    accountId,
    email: emailFromTokens(accessToken, idToken),
    expiresAt,
  };
}

export function exchangeCode(
  code: string,
  verifier: string,
  fetchImpl: FetchFn = fetch,
): Promise<ChatGptTokens> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CHATGPT_OAUTH.clientId,
      code,
      code_verifier: verifier,
      redirect_uri: CHATGPT_OAUTH.redirectUri,
    }),
    fetchImpl,
  );
}

export function refreshTokens(
  current: Pick<ChatGptTokens, 'refreshToken' | 'idToken'>,
  fetchImpl: FetchFn = fetch,
): Promise<ChatGptTokens> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: CHATGPT_OAUTH.clientId,
    }),
    fetchImpl,
    current,
  );
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2933}</style></head><body><h1>${title}</h1><p>${body}</p></body></html>`;

export type CallbackResult = { code: string } | { error: 'denied' | 'state' | 'missing_code' };

export interface CallbackListener {
  /** Resolves with the code once a valid callback arrives (or a terminal error). */
  result: Promise<CallbackResult>;
  /** Shows the final page to the browser that delivered the code. */
  finish(success: boolean): void;
  close(): Promise<void>;
}

/**
 * One-shot loopback listener for the OAuth redirect. Binds 127.0.0.1 only, accepts only the
 * callback path with a loopback Host header (DNS-rebinding defence), and verifies `state`.
 */
export function startCallbackListener(
  state: string,
  port: number = CHATGPT_OAUTH.callbackPort,
): Promise<CallbackListener> {
  let settle!: (value: CallbackResult) => void;
  const result = new Promise<CallbackResult>((resolve) => (settle = resolve));
  let pending: ServerResponse | null = null;
  let done = false;
  const server: Server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    const host = (req.headers.host ?? '').toLowerCase();
    if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) {
      res.writeHead(421).end();
      return;
    }
    // A request target such as "//" makes new URL() throw; an uncaught throw here would end the server process.
    let url: URL | null;
    try {
      url = new URL(`http://localhost:${port}${req.url?.startsWith('/') ? req.url : '/'}`);
    } catch {
      url = null;
    }
    if (!url || req.method !== 'GET' || url.pathname !== CHATGPT_OAUTH.callbackPath || done) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const html = (status: number, title: string, body: string) =>
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(page(title, body));
    if (!stateMatches(state, url.searchParams.get('state'))) {
      // A forged or stale callback must not cancel the real sign-in.
      html(400, 'Sign-in link expired', 'Start ChatGPT sign-in again from EzyChat Lite.');
      return;
    }
    done = true;
    if (url.searchParams.get('error')) {
      html(400, 'Sign-in cancelled', 'You can close this tab and try again from EzyChat Lite.');
      settle({ error: 'denied' });
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      html(400, 'Sign-in failed', 'You can close this tab and try again from EzyChat Lite.');
      settle({ error: 'missing_code' });
      return;
    }
    pending = res;
    settle({ code });
  });
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        new OAuthError(
          error.code === 'EADDRINUSE'
            ? `Port ${port} is in use (another Codex or OpenClaw sign-in may be open). Close it and try again.`
            : 'Cannot start the local ChatGPT sign-in listener.',
        ),
      );
    });
    server.listen(port, CHATGPT_OAUTH.callbackHost, () => {
      server.removeAllListeners('error');
      server.on('error', () => {});
      resolve({
        result,
        finish(success) {
          const res = pending;
          pending = null;
          if (!res) return;
          res
            .writeHead(success ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
            .end(
              success
                ? page(
                    'Signed in',
                    'Signed in — you can close this tab and return to EzyChat Lite.',
                  )
                : page('Sign-in failed', 'You can close this tab and try again from EzyChat Lite.'),
            );
        },
        close() {
          done = true;
          settle({ error: 'denied' });
          const closed = new Promise<void>((resolve) => server.close(() => resolve()));
          server.closeIdleConnections();
          // Let the final page flush, then drop any keep-alive sockets so the port is released.
          setTimeout(() => server.closeAllConnections(), 1000).unref();
          return closed;
        },
      });
    });
  });
}
