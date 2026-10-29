/**
 * Zoho OAuth (server-based client, offline access) and the few Zoho CRM REST v8 calls the
 * connector needs. The accounts and API hosts are checked against Zoho's data-centre hosts before
 * any request; the fake replaces them (and `fetch`) so tests and `--fake-wa` never reach Zoho.
 *
 * Never log tokens, codes, URLs with codes, names, emails or phone numbers.
 */
import { zohoAccountsHost, type ZohoCrmModule, type ZohoRegion } from '@ezychat/shared';

/** Read Contacts and Leads, add Leads, read users (lead owner) and the organisation. */
export const ZOHO_SCOPES = [
  'ZohoCRM.modules.contacts.READ',
  'ZohoCRM.modules.leads.READ',
  'ZohoCRM.modules.leads.CREATE',
  'ZohoCRM.users.READ',
  'ZohoCRM.org.READ',
] as const;

export const ZOHO_TIMEOUT_MS = 10_000;
export const ZOHO_MAX_BYTES = 2 * 1024 * 1024;

export interface ZohoApp {
  clientId: string;
  clientSecret: string;
}

/** Where a data centre signs in and which API hosts its tokens may name. */
export interface ZohoHosts {
  /** `https://accounts.zoho.<region>` (no path). */
  accounts(region: ZohoRegion): string;
  /** True for an API base (`api_domain`) Zoho may return. */
  isApiDomain(url: string): boolean;
  /** True for an accounts server Zoho may name in the redirect (`accounts-server`). */
  isAccountsServer(url: string): boolean;
}

const API_DOMAIN = /^https:\/\/www\.zohoapis\.(com|eu|in|com\.au|jp|ca|sa)$/;

export const ZOHO_HOSTS: ZohoHosts = {
  accounts: (region) => `https://${zohoAccountsHost(region)}`,
  isApiDomain: (url) => API_DOMAIN.test(url),
  isAccountsServer: (url) =>
    (['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa'] as const).some(
      (region) => url === `https://${zohoAccountsHost(region)}`,
    ),
};

/**
 * `expired`: Zoho refused the saved sign-in (invalid refresh token, or 401 with a fresh token).
 * `unavailable`: network error, timeout, 429 or 5xx. `rejected`: any other answer.
 */
export type ZohoErrorKind = 'expired' | 'unavailable' | 'rejected';

export class ZohoError extends Error {
  override name = 'ZohoError';
  constructor(
    readonly kind: ZohoErrorKind,
    readonly status: number | null = null,
  ) {
    super(`Zoho CRM ${kind}${status ? ` (${status})` : ''}`);
  }
}

export interface ZohoTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  /** The account's API base, e.g. https://www.zohoapis.com. */
  apiDomain: string;
  /** The account's accounts server (token refresh and revoke go there). */
  accountsServer: string;
}

export interface ZohoFoundRecord {
  module: ZohoCrmModule;
  id: string;
  name: string;
  company: string | null;
  owner: string | null;
  status: string | null;
}

export interface ZohoLeadInput {
  firstName: string | null;
  lastName: string;
  company: string;
  phone: string;
  email: string | null;
  leadSource: string;
  description: string | null;
  ownerId: string | null;
}

type FetchFn = typeof fetch;

async function readBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > ZOHO_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ZohoError('unavailable');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    throw new ZohoError('unavailable');
  }
}

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const obj = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const list = (value: unknown) =>
  Array.isArray(value) ? (value as unknown[]).map(obj) : ([] as Record<string, unknown>[]);

/** A lookup field (`Owner`, `Account_Name`): `{ name, id }` or a plain string. */
const lookupName = (value: unknown) => str(value) ?? str(obj(value).name);

/** Search values for one WhatsApp number: `+<digits>` and `<digits>` (Zoho matches stored text). */
export function phoneVariants(digits: string): string[] {
  const clean = digits.replace(/\D/g, '');
  return clean ? [`+${clean}`, clean] : [];
}

export class ZohoClient {
  constructor(
    readonly app: ZohoApp,
    readonly hosts: ZohoHosts = ZOHO_HOSTS,
    private readonly fetchImpl: FetchFn = fetch,
  ) {}

  authorizationUrl(input: { region: ZohoRegion; redirectUri: string; state: string }): string {
    const url = new URL('/oauth/v2/auth', this.hosts.accounts(input.region));
    url.searchParams.set('client_id', this.app.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', ZOHO_SCOPES.join(','));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  private async request(
    url: string,
    init: RequestInit,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(ZOHO_TIMEOUT_MS)])
          : AbortSignal.timeout(ZOHO_TIMEOUT_MS),
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new ZohoError('unavailable');
    }
    const json = parseJson(await readBody(response));
    const status = response.status;
    if (response.ok) return { status, json };
    if (status === 429 || status >= 500) throw new ZohoError('unavailable', status);
    if (status === 401) throw new ZohoError('expired', status);
    throw new ZohoError('rejected', status);
  }

  /**
   * Zoho answers a refused code or refresh token with an `error` field (HTTP 200 or 400): a refused
   * refresh token means the sign-in expired.
   */
  private async tokenRequest(
    accountsServer: string,
    body: URLSearchParams,
    previous: { refreshToken: string; apiDomain: string } | null,
  ): Promise<ZohoTokens> {
    if (!this.hosts.isAccountsServer(accountsServer)) throw new ZohoError('rejected');
    body.set('client_id', this.app.clientId);
    body.set('client_secret', this.app.clientSecret);
    let json: Record<string, unknown>;
    try {
      ({ json } = await this.request(`${accountsServer}/oauth/v2/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
      }));
    } catch (error) {
      if (previous && error instanceof ZohoError && error.status === 400)
        throw new ZohoError('expired', 400);
      throw error;
    }
    if (str(json.error)) throw new ZohoError(previous ? 'expired' : 'rejected');
    const accessToken = str(json.access_token);
    const refreshToken = str(json.refresh_token) ?? previous?.refreshToken ?? null;
    const apiDomain = str(json.api_domain) ?? previous?.apiDomain ?? null;
    if (!accessToken || !refreshToken || !apiDomain || !this.hosts.isApiDomain(apiDomain))
      throw new ZohoError('rejected');
    const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
    return {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      apiDomain,
      accountsServer,
    };
  }

  exchangeCode(code: string, redirectUri: string, accountsServer: string): Promise<ZohoTokens> {
    return this.tokenRequest(
      accountsServer,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
      null,
    );
  }

  refresh(tokens: ZohoTokens): Promise<ZohoTokens> {
    return this.tokenRequest(
      tokens.accountsServer,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }),
      tokens,
    );
  }

  /** Best effort: a failure is ignored (the tokens are deleted here anyway). */
  async revoke(tokens: ZohoTokens): Promise<void> {
    if (!this.hosts.isAccountsServer(tokens.accountsServer)) return;
    try {
      await this.request(`${tokens.accountsServer}/oauth/v2/token/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tokens.refreshToken }),
      });
    } catch {
      // ignore
    }
  }

  private api(
    tokens: Pick<ZohoTokens, 'accessToken' | 'apiDomain'>,
    path: string,
    init: RequestInit = {},
  ) {
    if (!this.hosts.isApiDomain(tokens.apiDomain)) throw new ZohoError('rejected');
    return this.request(`${tokens.apiDomain}/crm/v8${path}`, {
      ...init,
      headers: {
        authorization: `Zoho-oauthtoken ${tokens.accessToken}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  }

  /** The organisation's name and its CRM URL part (`domain_name`). */
  async organisation(
    tokens: Pick<ZohoTokens, 'accessToken' | 'apiDomain'>,
  ): Promise<{ name: string | null; domain: string | null }> {
    const { json } = await this.api(tokens, '/org');
    const org = list(json.org)[0] ?? {};
    const domain = str(org.domain_name);
    return {
      name: str(org.company_name)?.slice(0, 200) ?? null,
      domain: domain && /^[\w.-]{1,100}$/.test(domain) ? domain : null,
    };
  }

  /** The signed-in user's email, and the active users (lead owner choice). */
  async users(
    tokens: Pick<ZohoTokens, 'accessToken' | 'apiDomain'>,
  ): Promise<{ me: string | null; active: Array<{ id: string; name: string }> }> {
    const current = await this.api(tokens, '/users?type=CurrentUser');
    const me = str(list(current.json.users)[0]?.email);
    const active = await this.api(tokens, '/users?type=ActiveUsers&per_page=200');
    return {
      me: me?.slice(0, 254) ?? null,
      active: list(active.json.users)
        .slice(0, 200)
        .flatMap((user) => {
          const id = str(user.id);
          if (!id || !/^\d{1,40}$/.test(id)) return [];
          const name = str(user.full_name) ?? str(user.email) ?? id;
          return [{ id, name: name.slice(0, 120) }];
        }),
    };
  }

  /** The first Contact, else the first Lead, whose phone fields match this number; null if none. */
  async findByPhone(
    tokens: Pick<ZohoTokens, 'accessToken' | 'apiDomain'>,
    digits: string,
    signal?: AbortSignal,
  ): Promise<ZohoFoundRecord | null> {
    for (const module of ['Contacts', 'Leads'] as const)
      for (const phone of phoneVariants(digits)) {
        const { status, json } = await this.api(
          tokens,
          `/${module}/search?phone=${encodeURIComponent(phone)}&per_page=1`,
          { signal },
        );
        // 204: nothing found.
        if (status === 204) continue;
        const row = list(json.data)[0];
        const id = row && str(row.id);
        if (!row || !id || !/^\d{1,40}$/.test(id)) continue;
        const name =
          str(row.Full_Name) ??
          ([str(row.First_Name), str(row.Last_Name)].filter(Boolean).join(' ') || id);
        return {
          module,
          id,
          name: name.slice(0, 200),
          company:
            (module === 'Contacts' ? lookupName(row.Account_Name) : str(row.Company))?.slice(
              0,
              200,
            ) ?? null,
          owner: lookupName(row.Owner)?.slice(0, 120) ?? null,
          status: module === 'Leads' ? (str(row.Lead_Status)?.slice(0, 60) ?? null) : null,
        };
      }
    return null;
  }

  /** Adds one Lead (Zoho's workflow and assignment rules run); returns its id. */
  async createLead(
    tokens: Pick<ZohoTokens, 'accessToken' | 'apiDomain'>,
    lead: ZohoLeadInput,
    signal?: AbortSignal,
  ): Promise<string> {
    const record: Record<string, unknown> = {
      Last_Name: lead.lastName,
      Company: lead.company,
      Mobile: lead.phone,
      Lead_Source: lead.leadSource,
    };
    if (lead.firstName) record.First_Name = lead.firstName;
    if (lead.email) record.Email = lead.email;
    if (lead.description) record.Description = lead.description;
    if (lead.ownerId) record.Owner = { id: lead.ownerId };
    const { json } = await this.api(tokens, '/Leads', {
      method: 'POST',
      signal,
      body: JSON.stringify({ data: [record], trigger: ['approval', 'workflow', 'blueprint'] }),
    });
    const first = list(json.data)[0] ?? {};
    const id = str(obj(first.details).id);
    if (str(first.status) !== 'success' || !id) throw new ZohoError('rejected');
    return id;
  }
}
