// OAuth for partner (MCP) connections through the MCP SDK's `auth()`: discovery (RFC 9728 / 8414),
// dynamic client registration (RFC 7591) or a given client ID (+ secret), authorization code with
// PKCE (S256), and refresh. Ported from Enterprise ent-connectors (packages/ent-connectors/src/
// oauth.ts, written for the AI SDK MCP client) to the MCP SDK's OAuthClientProvider. Everything is
// kept in one OAuthState that the caller stores encrypted; nothing here logs.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { ConnectorEntry, ConnectorProblem } from '@ezychat/shared';

/** Where the partner's sign-in page sends the browser back (this computer only). */
export const OAUTH_CALLBACK_PATH = '/api/connectors/mcp/oauth/callback';
/** A started sign-in can be finished for this long, once. */
export const SIGN_IN_TTL_MS = 10 * 60_000;
const MAX_PENDING = 20;

export interface OAuthState {
  tokens?: OAuthTokens;
  /** When `tokens` were saved (ms), for `expires_in`. */
  obtainedAt?: number;
  client?: OAuthClientInformationMixed;
  /** The client was registered automatically (RFC 7591). */
  dynamic?: boolean;
  discovery?: OAuthDiscoveryState;
  /** The redirect address the client was registered / authorized with. */
  redirectUrl?: string;
  codeVerifier?: string;
}

/** Thrown when a background call (agent turn, test) would need the admin to sign in again. */
export class InteractiveSignInNeeded extends Error {
  constructor() {
    super('sign-in needed');
    this.name = 'InteractiveSignInNeeded';
  }
}

export interface ProviderOptions {
  redirectUrl: string;
  scope?: string;
  /** false: never start a browser sign-in (agent turns, tests); the call fails instead. */
  interactive: boolean;
  /** Interactive only: receives the partner's sign-in page address. */
  onAuthorizationUrl?: (url: URL) => void;
  /** The `state` parameter to use (the pending sign-in's key). */
  stateValue?: string;
  now?: () => number;
}

export class ConnectorOAuthProvider implements OAuthClientProvider {
  constructor(
    readonly data: OAuthState,
    private readonly options: ProviderOptions,
  ) {}

  get redirectUrl(): string {
    return this.data.redirectUrl ?? this.options.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'EzyChat',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(this.options.scope ? { scope: this.options.scope } : {}),
    };
  }

  tokens() {
    return this.data.tokens;
  }

  saveTokens(tokens: OAuthTokens) {
    this.data.tokens = tokens;
    this.data.obtainedAt = (this.options.now ?? Date.now)();
  }

  redirectToAuthorization(url: URL) {
    if (!this.options.interactive || !this.options.onAuthorizationUrl)
      throw new InteractiveSignInNeeded();
    this.options.onAuthorizationUrl(url);
  }

  saveCodeVerifier(codeVerifier: string) {
    this.data.codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.data.codeVerifier) throw new Error('no code verifier');
    return this.data.codeVerifier;
  }

  clientInformation() {
    return this.data.client;
  }

  saveClientInformation(client: OAuthClientInformationMixed) {
    // A given client keeps its ID and secret; only the issuer stamp is added.
    if (this.data.client && this.data.dynamic !== true)
      this.data.client = { ...this.data.client, ...client };
    else {
      this.data.client = client;
      this.data.dynamic = true;
    }
    this.data.redirectUrl = this.redirectUrl;
  }

  state(): string {
    return this.options.stateValue ?? randomBytes(32).toString('base64url');
  }

  saveDiscoveryState(state: OAuthDiscoveryState) {
    this.data.discovery = state;
  }

  discoveryState() {
    return this.data.discovery;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'tokens') {
      delete this.data.tokens;
      delete this.data.obtainedAt;
    }
    if ((scope === 'all' || scope === 'client') && this.data.dynamic) {
      delete this.data.client;
      delete this.data.dynamic;
    }
    if (scope === 'all' || scope === 'verifier') delete this.data.codeVerifier;
    if (scope === 'all' || scope === 'discovery') delete this.data.discovery;
  }
}

/** True when the access token has (almost) run out. */
export function tokensExpired(data: OAuthState, now: number, earlyMs = 30_000): boolean {
  const seconds = data.tokens?.expires_in;
  if (!seconds || data.obtainedAt === undefined) return false;
  return data.obtainedAt + seconds * 1000 - earlyMs <= now;
}

/** What a started sign-in becomes when the partner sends the browser back. */
export interface PendingSignIn {
  requestId: string;
  state: string;
  createdAt: number;
  connectorId: string;
  /** The list entry as it was when the sign-in started (saved with the connection). */
  entry: ConnectorEntry;
  url: string;
  userId: number;
  ip: string | null;
  data: OAuthState;
  result:
    { status: 'pending' } | { status: 'done' } | { status: 'failed'; problem: ConnectorProblem };
  /** The callback has been used (state is single use). */
  used: boolean;
}

/**
 * Started sign-ins in memory: single use, 10 minutes, at most 20 at a time. An expired one is kept
 * another 10 minutes so the page that polls it learns it expired.
 */
export class PendingSignIns {
  private readonly byId = new Map<string, PendingSignIn>();

  constructor(private readonly now: () => number = Date.now) {}

  /** True when this started sign-in can no longer be finished. */
  expired(p: PendingSignIn): boolean {
    return this.now() - p.createdAt > SIGN_IN_TTL_MS;
  }

  /** Forgets every sign-in of this connector (Disconnect). */
  forget(connectorId: string) {
    for (const [id, p] of this.byId) if (p.connectorId === connectorId) this.byId.delete(id);
  }

  private sweep() {
    const cutoff = this.now() - 2 * SIGN_IN_TTL_MS;
    for (const [id, p] of this.byId) if (p.createdAt < cutoff) this.byId.delete(id);
  }

  create(
    p: Omit<PendingSignIn, 'requestId' | 'state' | 'createdAt' | 'result' | 'used'>,
  ): PendingSignIn {
    this.sweep();
    while (this.byId.size >= MAX_PENDING) {
      const oldest = this.byId.keys().next().value;
      if (oldest === undefined) break;
      this.byId.delete(oldest);
    }
    const entry: PendingSignIn = {
      ...p,
      requestId: randomBytes(16).toString('hex'),
      state: randomBytes(32).toString('base64url'),
      createdAt: this.now(),
      result: { status: 'pending' },
      used: false,
    };
    this.byId.set(entry.requestId, entry);
    return entry;
  }

  get(requestId: string): PendingSignIn | null {
    this.sweep();
    return this.byId.get(requestId) ?? null;
  }

  /** A sign-in of this connector that is still waiting for the partner, or null. */
  waiting(connectorId: string): PendingSignIn | null {
    this.sweep();
    for (const p of this.byId.values())
      if (p.connectorId === connectorId && p.result.status === 'pending' && !this.expired(p))
        return p;
    return null;
  }

  /** The pending sign-in for a callback `state`, marked used. Null when unknown, used or expired. */
  takeByState(state: string): PendingSignIn | null {
    this.sweep();
    const given = Buffer.from(state);
    for (const p of this.byId.values()) {
      const expected = Buffer.from(p.state);
      const same = expected.length === given.length && timingSafeEqual(expected, given);
      if (same && !p.used && p.result.status === 'pending' && !this.expired(p)) {
        p.used = true;
        return p;
      }
    }
    return null;
  }

  delete(requestId: string) {
    this.byId.delete(requestId);
  }

  clear() {
    this.byId.clear();
  }
}
