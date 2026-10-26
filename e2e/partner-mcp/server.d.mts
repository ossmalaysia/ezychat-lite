// Types of server.mjs for the server unit tests (TEST ONLY).
export type PartnerEndpoint = 'none' | 'api-key' | 'credentials' | 'oauth' | 'oauth-own-app';
export type PartnerState = 'ok' | 'down' | 'refused' | 'rpc_error';

export declare const ENDPOINTS: readonly PartnerEndpoint[];
export declare const STATES: readonly PartnerState[];
export declare const PARTNER_CREDENTIALS: {
  apiKey: string;
  account: string;
  username: string;
  password: string;
  publicClientId: string;
  clientId: string;
  clientSecret: string;
};
export declare const INVOICES: ReadonlyArray<{
  number: string;
  customer: string;
  status: string;
  total: string;
}>;
export declare const STOCK: ReadonlyArray<{ sku: string; name: string; in_stock: number }>;
export declare const PRICE_LISTS: ReadonlyArray<{ id: string; name: string }>;

export interface PartnerOAuthServer {
  revoked: number;
  expireAccessTokens(): void;
  revokeAll(): void;
}

export interface PartnerKit {
  origin: string;
  port: number;
  cert?: string;
  controlToken: string;
  listPublicKey: string;
  listBaseUrl: string;
  listUrl: string;
  state: {
    calls: Array<{ endpoint: PartnerEndpoint; tool: string }>;
    quotations: Array<Record<string, unknown>>;
  };
  oauth: Record<'oauth' | 'oauth-own-app', PartnerOAuthServer>;
  url(id: PartnerEndpoint): string;
  getState(id: PartnerEndpoint): PartnerState;
  setState(id: PartnerEndpoint, state: PartnerState): void;
  expireAccessTokens(id: PartnerEndpoint): void;
  setDelay(id: PartnerEndpoint, ms: number): void;
  bumpList(): number;
  close(): Promise<void>;
}

export declare function startPartnerMcp(options?: {
  port?: number;
  tls?: boolean | { cert: string; key: string };
  accessTokenTtlSeconds?: number;
  states?: Partial<Record<PartnerEndpoint, PartnerState>>;
  controlToken?: string;
  log?: (line: string) => void;
  list?: { privateKey: unknown; publicKeyBase64: string; sequence?: number };
}): Promise<PartnerKit>;

export declare function completeConsent(
  authorizationUrl: string | URL,
  decision?: 'allow' | 'cancel',
  ca?: string,
): Promise<URL>;
