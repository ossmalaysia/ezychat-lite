/**
 * In-process stand-in for Zoho (sign-in and CRM), used ONLY when the server runs with `--fake-wa`
 * (tests, e2e, Dev Builds) and no Zoho app is configured. Nothing here touches the network: `fetch`
 * answers the same requests ZohoClient sends to the fake hosts.
 */
import { randomBytes } from 'node:crypto';
import type { ZohoHosts } from './zoho.js';

export const FAKE_ZOHO_ACCOUNTS = 'https://accounts.fake-zoho.invalid';
export const FAKE_ZOHO_API = 'https://www.fake-zoho.invalid';
export const FAKE_ZOHO_HOSTS: ZohoHosts = {
  accounts: () => FAKE_ZOHO_ACCOUNTS,
  isApiDomain: (url) => url === FAKE_ZOHO_API,
  isAccountsServer: (url) => url === FAKE_ZOHO_ACCOUNTS,
};
export const FAKE_ZOHO_APP = { clientId: 'fake-zoho-client', clientSecret: 'fake-zoho-secret' };
export const FAKE_ZOHO_ACCOUNT = 'demo.crm@example.com';
export const FAKE_ZOHO_ORG = 'Demo Trading Sdn Bhd';

export type FakeZohoMode = 'ok' | 'expired' | 'unavailable';

export interface FakeZohoRecord {
  module: 'Contacts' | 'Leads';
  id: string;
  firstName: string | null;
  lastName: string;
  company: string | null;
  phone: string;
  email: string | null;
  owner: string;
  status: string | null;
  leadSource: string | null;
  description: string | null;
}

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const USERS = [
  { id: '4150868000000225013', full_name: 'Demo Owner', email: FAKE_ZOHO_ACCOUNT },
  { id: '4150868000000225021', full_name: 'Sales Rep', email: 'rep@example.com' },
];

/** Demo records (fake numbers): one Contact and one Lead. */
export function fakeZohoSeed(): FakeZohoRecord[] {
  return [
    {
      module: 'Contacts',
      id: '4150868000000412001',
      firstName: 'Farah',
      lastName: 'Aziz',
      company: 'Farah Catering Co',
      phone: '+60123110021',
      email: null,
      owner: 'Sales Rep',
      status: null,
      leadSource: null,
      description: null,
    },
    {
      module: 'Leads',
      id: '4150868000000498003',
      firstName: 'Jason',
      lastName: 'Lim',
      company: 'Lim Trading',
      phone: '60129001234',
      email: null,
      owner: 'Demo Owner',
      status: 'Contacted',
      leadSource: 'Website',
      description: null,
    },
  ];
}

export class FakeZoho {
  mode: FakeZohoMode = 'ok';
  records: FakeZohoRecord[] = fakeZohoSeed();
  /** Requests answered, by kind (tests check what was asked, never the network). */
  readonly calls: string[] = [];
  private readonly codes = new Set<string>();
  private readonly access = new Set<string>();
  private readonly refresh = new Set<string>();
  private nextId = 600000;

  /** The consent page's Accept: a one-time code. */
  issueCode(): string {
    const code = `fake-zoho-code-${randomBytes(8).toString('hex')}`;
    this.codes.add(code);
    return code;
  }

  private tokens(refresh?: string) {
    const accessToken = `fake-zoho-access-${randomBytes(8).toString('hex')}`;
    this.access.add(accessToken);
    const refreshToken = refresh ?? `fake-zoho-refresh-${randomBytes(8).toString('hex')}`;
    this.refresh.add(refreshToken);
    return {
      access_token: accessToken,
      expires_in: 3600,
      api_domain: FAKE_ZOHO_API,
      token_type: 'Bearer',
      ...(refresh ? {} : { refresh_token: refreshToken }),
    };
  }

  /** Drops every access token (the next API call gets 401 and refreshes). */
  expireAccessTokens() {
    this.access.clear();
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (this.mode === 'unavailable') {
      this.calls.push(`unavailable ${url.pathname}`);
      return json(503, { error: 'unavailable' });
    }
    const form = () =>
      new URLSearchParams(typeof init?.body === 'string' ? init.body : String(init?.body ?? ''));
    if (url.origin === FAKE_ZOHO_ACCOUNTS) {
      if (url.pathname === '/oauth/v2/token') {
        const body = form();
        this.calls.push(`token ${body.get('grant_type')}`);
        if (body.get('client_id') !== FAKE_ZOHO_APP.clientId)
          return json(200, { error: 'invalid_client' });
        if (body.get('grant_type') === 'authorization_code') {
          const code = body.get('code') ?? '';
          if (!this.codes.delete(code)) return json(200, { error: 'invalid_code' });
          return json(200, this.tokens());
        }
        const refresh = body.get('refresh_token') ?? '';
        if (this.mode === 'expired' || !this.refresh.has(refresh))
          return json(200, { error: 'invalid_code' });
        return json(200, this.tokens(refresh));
      }
      if (url.pathname === '/oauth/v2/token/revoke') {
        this.calls.push('revoke');
        this.refresh.delete(form().get('token') ?? '');
        return json(200, { status: 'success' });
      }
      return json(404, { error: 'not_found' });
    }
    if (url.origin !== FAKE_ZOHO_API || !url.pathname.startsWith('/crm/v8/'))
      return json(404, { error: 'not_found' });
    const token = new Headers(init?.headers).get('authorization')?.replace(/^Zoho-oauthtoken /, '');
    if (!token || !this.access.has(token) || this.mode === 'expired')
      return json(401, { code: 'INVALID_TOKEN' });
    const path = url.pathname.slice('/crm/v8'.length);
    this.calls.push(`${method} ${path}`);
    if (path === '/org')
      return json(200, { org: [{ company_name: FAKE_ZOHO_ORG, domain_name: 'org700123456' }] });
    if (path === '/users') {
      const type = url.searchParams.get('type');
      return json(200, { users: type === 'CurrentUser' ? [USERS[0]] : USERS });
    }
    const search = /^\/(Contacts|Leads)\/search$/.exec(path);
    if (search && method === 'GET') {
      const phone = (url.searchParams.get('phone') ?? '').trim();
      const found = this.records.find((r) => r.module === search[1] && r.phone === phone);
      if (!found) return json(204, null);
      const name = [found.firstName, found.lastName].filter(Boolean).join(' ');
      return json(200, {
        data: [
          {
            id: found.id,
            Full_Name: name,
            First_Name: found.firstName,
            Last_Name: found.lastName,
            ...(found.module === 'Contacts'
              ? { Account_Name: found.company ? { name: found.company, id: '1' } : null }
              : { Company: found.company, Lead_Status: found.status }),
            Owner: { name: found.owner, id: '2' },
          },
        ],
      });
    }
    if (path === '/Leads' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        data?: Array<Record<string, unknown>>;
      };
      const row = body.data?.[0] ?? {};
      if (typeof row.Last_Name !== 'string' || typeof row.Company !== 'string')
        return json(400, { data: [{ code: 'MANDATORY_NOT_FOUND', status: 'error' }] });
      const id = `4150868000000${this.nextId++}`;
      const owner = USERS.find((u) => u.id === (row.Owner as { id?: string } | undefined)?.id);
      this.records.push({
        module: 'Leads',
        id,
        firstName: typeof row.First_Name === 'string' ? row.First_Name : null,
        lastName: row.Last_Name,
        company: row.Company,
        phone: String(row.Mobile ?? ''),
        email: typeof row.Email === 'string' ? row.Email : null,
        owner: owner?.full_name ?? USERS[0]!.full_name,
        status: 'Not Contacted',
        leadSource: typeof row.Lead_Source === 'string' ? row.Lead_Source : null,
        description: typeof row.Description === 'string' ? row.Description : null,
      });
      return json(201, { data: [{ code: 'SUCCESS', status: 'success', details: { id } }] });
    }
    return json(404, { code: 'INVALID_URL_PATTERN' });
  };
}
