import { describe, expect, it, vi } from 'vitest';
import { requestLine, splitName } from './service.js';
import { ZOHO_HOSTS, ZohoClient, ZohoError, phoneVariants } from './zoho.js';

const APP = { clientId: '1000.TEST', clientSecret: 'secret' };
const TOKENS = { accessToken: 'at', apiDomain: 'https://www.zohoapis.com' };
const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status });

function client(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handler(new URL(String(input)), init ?? {}),
  );
  return { zoho: new ZohoClient(APP, ZOHO_HOSTS, fetchImpl as typeof fetch), fetchImpl };
}

describe('Zoho hosts', () => {
  it('accepts only Zoho accounts servers and API domains of its data centres', () => {
    expect(ZOHO_HOSTS.accounts('com')).toBe('https://accounts.zoho.com');
    expect(ZOHO_HOSTS.accounts('com.au')).toBe('https://accounts.zoho.com.au');
    expect(ZOHO_HOSTS.accounts('ca')).toBe('https://accounts.zohocloud.ca');
    expect(ZOHO_HOSTS.isAccountsServer('https://accounts.zoho.eu')).toBe(true);
    expect(ZOHO_HOSTS.isAccountsServer('https://accounts.zoho.eu.evil.example')).toBe(false);
    expect(ZOHO_HOSTS.isAccountsServer('http://accounts.zoho.com')).toBe(false);
    expect(ZOHO_HOSTS.isApiDomain('https://www.zohoapis.in')).toBe(true);
    expect(ZOHO_HOSTS.isApiDomain('https://www.zohoapis.com.cn')).toBe(false);
    expect(ZOHO_HOSTS.isApiDomain('https://www.zohoapis.com/x')).toBe(false);
  });
});

describe('ZohoClient', () => {
  it('builds the sign-in address in the chosen data centre with offline access', () => {
    const { zoho } = client(() => json(200, {}));
    const url = new URL(
      zoho.authorizationUrl({
        region: 'eu',
        redirectUri: 'http://127.0.0.1:7420/api/connectors/zoho-crm/callback',
        state: 's1',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.zoho.eu/oauth/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '1000.TEST',
      redirect_uri: 'http://127.0.0.1:7420/api/connectors/zoho-crm/callback',
      response_type: 'code',
      scope:
        'ZohoCRM.modules.contacts.READ,ZohoCRM.modules.leads.READ,ZohoCRM.modules.leads.CREATE,ZohoCRM.users.READ,ZohoCRM.org.READ',
      access_type: 'offline',
      prompt: 'consent',
      state: 's1',
    });
  });

  it('exchanges a code at the accounts server and checks the API domain', async () => {
    const { zoho, fetchImpl } = client((url, init) => {
      expect(url.toString()).toBe('https://accounts.zoho.com/oauth/v2/token');
      const body = new URLSearchParams(String(init.body));
      expect(body.get('client_secret')).toBe('secret');
      expect(body.get('grant_type')).toBe('authorization_code');
      return json(200, {
        access_token: 'a',
        refresh_token: 'r',
        api_domain: 'https://www.zohoapis.com',
        expires_in: 3600,
      });
    });
    const tokens = await zoho.exchangeCode('c', 'http://x/cb', 'https://accounts.zoho.com');
    expect(tokens).toMatchObject({
      accessToken: 'a',
      refreshToken: 'r',
      apiDomain: 'https://www.zohoapis.com',
      accountsServer: 'https://accounts.zoho.com',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(zoho.exchangeCode('c', 'x', 'https://evil.example')).rejects.toMatchObject({
      kind: 'rejected',
    });
    const other = client(() =>
      json(200, { access_token: 'a', refresh_token: 'r', api_domain: 'https://evil.example' }),
    );
    await expect(
      other.zoho.exchangeCode('c', 'x', 'https://accounts.zoho.com'),
    ).rejects.toMatchObject({ kind: 'rejected' });
    const refused = client(() => json(200, { error: 'invalid_code' }));
    await expect(
      refused.zoho.exchangeCode('c', 'x', 'https://accounts.zoho.com'),
    ).rejects.toMatchObject({ kind: 'rejected' });
  });

  it('keeps the refresh token on refresh and maps a refused one to expired', async () => {
    const stored = {
      accessToken: 'old',
      refreshToken: 'r',
      expiresAt: 0,
      apiDomain: 'https://www.zohoapis.com',
      accountsServer: 'https://accounts.zoho.com',
    };
    const ok = client(() => json(200, { access_token: 'new', expires_in: 60 }));
    expect(await ok.zoho.refresh(stored)).toMatchObject({
      accessToken: 'new',
      refreshToken: 'r',
      apiDomain: 'https://www.zohoapis.com',
    });
    const refused = client(() => json(200, { error: 'invalid_code' }));
    await expect(refused.zoho.refresh(stored)).rejects.toMatchObject({ kind: 'expired' });
    const bad = client(() => json(400, { error: 'invalid_client' }));
    await expect(bad.zoho.refresh(stored)).rejects.toMatchObject({ kind: 'expired', status: 400 });
  });

  it('maps HTTP errors, network failures and oversized bodies', async () => {
    const cases: Array<[() => Response | Promise<Response>, string, number | null]> = [
      [() => json(429, {}), 'unavailable', 429],
      [() => json(502, {}), 'unavailable', 502],
      [() => json(401, {}), 'expired', 401],
      [() => json(403, {}), 'rejected', 403],
      [() => Promise.reject(new TypeError('fetch failed')), 'unavailable', null],
      [() => new Response('x'.repeat(2 * 1024 * 1024 + 1)), 'unavailable', null],
      [() => new Response('not json'), 'unavailable', null],
    ];
    for (const [answer, kind, status] of cases) {
      const { zoho } = client(answer);
      const error = await zoho.organisation(TOKENS).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ZohoError);
      expect(error).toMatchObject({ kind, status });
    }
    // an API domain that is not Zoho's is never called
    const { zoho, fetchImpl } = client(() => json(200, {}));
    await expect(
      zoho.organisation({ accessToken: 'a', apiDomain: 'https://evil.example' }),
    ).rejects.toMatchObject({ kind: 'rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a cancelled request is not a Zoho failure', async () => {
    const controller = new AbortController();
    const { zoho } = client(() => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(zoho.findByPhone(TOKENS, '60123', controller.signal)).rejects.toThrow('aborted');
  });

  it('reads the organisation and users', async () => {
    const { zoho } = client((url) => {
      if (url.pathname === '/crm/v8/org')
        return json(200, { org: [{ company_name: 'Kopi Apong', domain_name: 'org1' }] });
      if (url.searchParams.get('type') === 'CurrentUser')
        return json(200, { users: [{ id: '1', email: 'me@example.com' }] });
      return json(200, {
        users: [
          { id: '1', full_name: 'Aisyah' },
          { id: 'x1', full_name: 'Bad id' },
          { id: '2', email: 'daniel@example.com' },
        ],
      });
    });
    expect(await zoho.organisation(TOKENS)).toEqual({ name: 'Kopi Apong', domain: 'org1' });
    expect(await zoho.users(TOKENS)).toEqual({
      me: 'me@example.com',
      active: [
        { id: '1', name: 'Aisyah' },
        { id: '2', name: 'daniel@example.com' },
      ],
    });
    const odd = client(() => json(200, { org: [{ domain_name: '../x' }] }));
    expect(await odd.zoho.organisation(TOKENS)).toEqual({ name: null, domain: null });
  });

  it('finds a Contact first, then a Lead, trying +digits and digits', async () => {
    const asked: string[] = [];
    const { zoho } = client((url) => {
      asked.push(`${url.pathname} ${url.searchParams.get('phone')}`);
      if (url.pathname === '/crm/v8/Leads/search' && url.searchParams.get('phone') === '60123')
        return json(200, {
          data: [
            {
              id: '77',
              First_Name: 'Jason',
              Last_Name: 'Lim',
              Company: 'Lim Trading',
              Lead_Status: 'Contacted',
              Owner: { name: 'Mei Ling', id: '5' },
            },
          ],
        });
      return json(204, null);
    });
    expect(await zoho.findByPhone(TOKENS, '+601-23')).toEqual({
      module: 'Leads',
      id: '77',
      name: 'Jason Lim',
      company: 'Lim Trading',
      owner: 'Mei Ling',
      status: 'Contacted',
    });
    expect(asked).toEqual([
      '/crm/v8/Contacts/search +60123',
      '/crm/v8/Contacts/search 60123',
      '/crm/v8/Leads/search +60123',
      '/crm/v8/Leads/search 60123',
    ]);
    const contact = client(() =>
      json(200, {
        data: [{ id: '9', Full_Name: 'Farah Aziz', Account_Name: { name: 'Farah Co', id: '1' } }],
      }),
    );
    expect(await contact.zoho.findByPhone(TOKENS, '60111')).toMatchObject({
      module: 'Contacts',
      name: 'Farah Aziz',
      company: 'Farah Co',
      owner: null,
      status: null,
    });
    const badId = client(() => json(200, { data: [{ id: 'not-a-number' }] }));
    expect(await badId.zoho.findByPhone(TOKENS, '60111')).toBeNull();
    expect(await badId.zoho.findByPhone(TOKENS, '')).toBeNull();
  });

  it('creates a lead with the workflow triggers and returns its id', async () => {
    let sent: Record<string, unknown> = {};
    const { zoho } = client((_url, init) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return json(201, { data: [{ status: 'success', details: { id: '123' } }] });
    });
    const id = await zoho.createLead(TOKENS, {
      firstName: null,
      lastName: 'Kavitha',
      company: 'Kavitha',
      phone: '+60132228899',
      email: null,
      leadSource: 'WhatsApp',
      description: null,
      ownerId: null,
    });
    expect(id).toBe('123');
    expect(sent).toEqual({
      data: [
        {
          Last_Name: 'Kavitha',
          Company: 'Kavitha',
          Mobile: '+60132228899',
          Lead_Source: 'WhatsApp',
        },
      ],
      trigger: ['approval', 'workflow', 'blueprint'],
    });
    const failed = client(() => json(201, { data: [{ status: 'error', code: 'DUPLICATE_DATA' }] }));
    await expect(
      failed.zoho.createLead(TOKENS, {
        firstName: 'A',
        lastName: 'B',
        company: 'C',
        phone: '+1',
        email: 'a@b.c',
        leadSource: 'WhatsApp',
        description: 'd',
        ownerId: '5',
      }),
    ).rejects.toMatchObject({ kind: 'rejected' });
  });

  it('revokes best effort, only at a Zoho accounts server', async () => {
    const { zoho, fetchImpl } = client(() => Promise.reject(new Error('down')));
    const tokens = {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 0,
      apiDomain: 'https://www.zohoapis.com',
      accountsServer: 'https://accounts.zoho.com',
    };
    await expect(zoho.revoke(tokens)).resolves.toBeUndefined();
    await zoho.revoke({ ...tokens, accountsServer: 'https://evil.example' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('lead helpers', () => {
  it('splits a name into first and last name', () => {
    expect(splitName('Dr. Kavitha Menon')).toEqual({ firstName: 'Dr. Kavitha', lastName: 'Menon' });
    expect(splitName(' 陈小明 ')).toEqual({ firstName: null, lastName: '陈小明' });
  });

  it('keeps the request summary to one line of at most 200 characters', () => {
    expect(requestLine('  a\n b  ')).toBe('a b');
    expect(requestLine('x'.repeat(300))).toHaveLength(200);
    expect(requestLine('   ')).toBeNull();
    expect(requestLine(undefined)).toBeNull();
  });

  it('phone variants', () => {
    expect(phoneVariants('+60 12-3')).toEqual(['+60123', '60123']);
    expect(phoneVariants('')).toEqual([]);
  });
});
