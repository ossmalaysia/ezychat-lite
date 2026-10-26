import { describe, expect, it, vi } from 'vitest';
import { GOOGLE_MAX_BYTES, GOOGLE_SCOPES, GoogleClient, GoogleError } from './google.js';

const ENDPOINTS = {
  auth: 'https://auth.test/o',
  token: 'https://auth.test/token',
  api: 'https://api.test/calendar/v3',
  revoke: 'https://auth.test/revoke',
};
const APP = { clientId: 'client-1', clientSecret: 'secret-1' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const jwt = (payload: object) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

function clientWith(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  );
  return { client: new GoogleClient(APP, ENDPOINTS, fetchImpl as typeof fetch), fetchImpl };
}

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return error instanceof GoogleError ? `${error.kind}:${error.status}` : 'other';
  }
}

describe('GoogleClient', () => {
  it('builds the PKCE sign-in address with offline access and every scope', () => {
    const { client } = clientWith(() => json(200, {}));
    const url = new URL(
      client.authorizationUrl({
        redirectUri: 'http://127.0.0.1:7420/cb',
        state: 's1',
        challenge: 'c1',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://auth.test/o');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-1',
      redirect_uri: 'http://127.0.0.1:7420/cb',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: 'c1',
      code_challenge_method: 'S256',
      state: 's1',
      scope: GOOGLE_SCOPES.join(' '),
    });
    expect(url.searchParams.has('client_secret')).toBe(false);
  });

  it('exchanges a code with the verifier and reads the account from the id token', async () => {
    const { client, fetchImpl } = clientWith(() =>
      json(200, {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 100,
        scope: 'openid email x',
        id_token: jwt({ email: 'shop@example.com' }),
      }),
    );
    const tokens = await client.exchangeCode('code-1', 'verifier-1', 'http://127.0.0.1:1/cb');
    expect(tokens).toMatchObject({
      accessToken: 'at',
      refreshToken: 'rt',
      account: 'shop@example.com',
      scope: ['openid', 'email', 'x'],
    });
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(ENDPOINTS.token);
    const body = new URLSearchParams(String(init!.body));
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'code-1',
      code_verifier: 'verifier-1',
      client_id: 'client-1',
      client_secret: 'secret-1',
    });
    expect(init!.redirect).toBe('error');
  });

  it('keeps the refresh token when Google sends none on refresh', async () => {
    const { client } = clientWith(() => json(200, { access_token: 'at2', expires_in: 10 }));
    const tokens = await client.refresh('rt');
    expect(tokens).toMatchObject({ accessToken: 'at2', refreshToken: 'rt', account: null });
  });

  it.each([
    ['invalid_grant on refresh', () => json(400, { error: 'invalid_grant' }), 'expired:400'],
    ['401', () => json(401, {}), 'expired:401'],
    ['5xx', () => json(503, {}), 'unavailable:503'],
    ['429', () => json(429, {}), 'unavailable:429'],
    ['other 4xx', () => json(403, {}), 'rejected:403'],
    ['bad JSON', () => new Response('not json', { status: 200 }), 'unavailable:null'],
    ['network error', () => Promise.reject(new TypeError('fetch failed')), 'unavailable:null'],
    ['no tokens', () => json(200, {}), 'rejected:null'],
  ])('maps %s', async (_name, answer, expected) => {
    const { client } = clientWith(answer);
    expect(await kindOf(client.refresh('rt'))).toBe(expected);
  });

  it('refuses a body above the size limit', async () => {
    const big = 'x'.repeat(GOOGLE_MAX_BYTES + 10);
    const { client } = clientWith(() => new Response(big, { status: 200 }));
    expect(await kindOf(client.calendarList('at'))).toBe('unavailable:null');
  });

  it('lists calendars with their access role and the bearer token', async () => {
    const { client, fetchImpl } = clientWith(() =>
      json(200, {
        items: [
          { id: 'a', summary: 'Mine', primary: true, accessRole: 'owner' },
          { id: 'b', summary: 'Shared', summaryOverride: 'Bookings', accessRole: 'writer' },
          { id: 'c', accessRole: 'reader' },
          { summary: 'no id' },
        ],
      }),
    );
    expect(await client.calendarList('at')).toEqual([
      { id: 'a', name: 'Mine', primary: true, accessRole: 'owner' },
      { id: 'b', name: 'Bookings', primary: false, accessRole: 'writer' },
      { id: 'c', name: 'c', primary: false, accessRole: 'reader' },
    ]);
    expect(new Headers(fetchImpl.mock.calls[0]![1]!.headers).get('authorization')).toBe(
      'Bearer at',
    );
  });

  it('reads busy times of one calendar and refuses a calendar Google reports errors for', async () => {
    const { client, fetchImpl } = clientWith((_url, init) => {
      const body = JSON.parse(String(init.body)) as { items: Array<{ id: string }> };
      const id = body.items[0]!.id;
      return json(200, {
        calendars: {
          [id]:
            id === 'bad'
              ? { errors: [{ reason: 'notFound' }] }
              : {
                  busy: [
                    { start: '2026-10-26T05:00:00Z', end: '2026-10-26T06:00:00Z' },
                    { start: 'x' },
                  ],
                },
        },
      });
    });
    expect(await client.freeBusy('at', 'cal', 0, 1000)).toEqual([
      { start: Date.parse('2026-10-26T05:00:00Z'), end: Date.parse('2026-10-26T06:00:00Z') },
    ]);
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(sent).toEqual({
      timeMin: new Date(0).toISOString(),
      timeMax: new Date(1000).toISOString(),
      items: [{ id: 'cal' }],
    });
    expect(await kindOf(client.freeBusy('at', 'bad', 0, 1))).toBe('rejected:null');
  });

  it('inserts an event with its own id, and treats 409 as already there', async () => {
    let status = 200;
    const { client, fetchImpl } = clientWith(() => json(status, { id: 'e' }));
    const event = {
      id: 'abc123',
      summary: 'S',
      description: 'D',
      start: 0,
      end: 60_000,
      timeZone: 'Asia/Kuala_Lumpur',
    };
    expect(await client.insertEvent('at', 'cal/1', event)).toBe(true);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.test/calendar/v3/calendars/cal%2F1/events',
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toMatchObject({
      id: 'abc123',
      start: { dateTime: '1970-01-01T00:00:00.000Z', timeZone: 'Asia/Kuala_Lumpur' },
    });
    status = 409;
    expect(await client.insertEvent('at', 'cal', event)).toBe(false);
    status = 500;
    expect(await kindOf(client.insertEvent('at', 'cal', event))).toBe('unavailable:500');
  });

  it('reads an event status, null when it is gone', async () => {
    let answer = () => json(200, { status: 'cancelled' });
    const { client } = clientWith(() => answer());
    expect(await client.eventStatus('at', 'cal', 'e')).toBe('cancelled');
    answer = () => json(200, {});
    expect(await client.eventStatus('at', 'cal', 'e')).toBe('confirmed');
    answer = () => json(404, {});
    expect(await client.eventStatus('at', 'cal', 'e')).toBeNull();
    answer = () => json(503, {});
    expect(await kindOf(client.eventStatus('at', 'cal', 'e'))).toBe('unavailable:503');
  });

  it('revokes best effort', async () => {
    const { client, fetchImpl } = clientWith(() => Promise.reject(new Error('down')));
    await expect(client.revoke('rt')).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('passes a caller abort through instead of calling it unavailable', async () => {
    const controller = new AbortController();
    const { client } = clientWith(() => {
      controller.abort();
      return Promise.reject(new Error('aborted'));
    });
    expect(await kindOf(client.calendarList('at', controller.signal))).toBe('other');
  });
});
