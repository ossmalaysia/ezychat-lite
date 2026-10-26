/**
 * In-process stand-in for Google (sign-in and Calendar), used ONLY when the server runs with
 * `--fake-wa` (tests, e2e, Dev Builds). Nothing here touches the network: `fetch` answers the same
 * requests GoogleClient sends to the fake base URLs.
 */
import { createHash, randomBytes } from 'node:crypto';
import { GOOGLE_SCOPES, type GoogleEndpoints } from './google.js';

const BASE = 'https://fake-google.invalid';
export const FAKE_GOOGLE_ENDPOINTS: GoogleEndpoints = {
  auth: `${BASE}/o/oauth2/v2/auth`,
  token: `${BASE}/token`,
  api: `${BASE}/calendar/v3`,
  revoke: `${BASE}/revoke`,
};
export const FAKE_GOOGLE_APP = { clientId: 'fake-client', clientSecret: 'fake-secret' };
export const FAKE_GOOGLE_ACCOUNT = 'demo.bookings@example.com';

export type FakeGoogleMode = 'ok' | 'expired' | 'unavailable';

export interface FakeGoogleEvent {
  calendarId: string;
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
}

const CALENDARS = [
  {
    id: 'primary-demo@example.com',
    summary: FAKE_GOOGLE_ACCOUNT,
    primary: true,
    accessRole: 'owner',
  },
  { id: 'bookings-demo@group.calendar.google.com', summary: 'Bookings', accessRole: 'owner' },
  {
    id: 'en.malaysia#holiday@group.v.calendar.google.com',
    summary: 'Holidays in Malaysia',
    accessRole: 'reader',
  },
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fakeJwt = (payload: object) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

export class FakeGoogle {
  mode: FakeGoogleMode = 'ok';
  busy: Array<{ start: string; end: string }> = [];
  readonly events: FakeGoogleEvent[] = [];
  /** Requests answered, by kind (tests check what was asked, never the network). */
  readonly calls: string[] = [];
  private readonly codes = new Map<string, { challenge: string; scope: string }>();
  private readonly access = new Set<string>();
  private readonly refresh = new Set<string>();

  /** The consent page's Allow: a one-time code bound to the PKCE challenge of that sign-in. */
  issueCode(challenge: string, scope: string): string {
    const code = `fake-code-${randomBytes(8).toString('hex')}`;
    this.codes.set(code, { challenge, scope });
    return code;
  }

  private tokens(scope: string, refresh?: string) {
    const accessToken = `fake-access-${randomBytes(8).toString('hex')}`;
    this.access.add(accessToken);
    const refreshToken = refresh ?? `fake-refresh-${randomBytes(8).toString('hex')}`;
    this.refresh.add(refreshToken);
    return {
      access_token: accessToken,
      expires_in: 3600,
      scope,
      token_type: 'Bearer',
      ...(refresh ? {} : { refresh_token: refreshToken }),
      id_token: fakeJwt({ email: FAKE_GOOGLE_ACCOUNT }),
    };
  }

  private async token(body: URLSearchParams): Promise<Response> {
    if (this.mode === 'unavailable') return json(503, { error: 'backend_error' });
    if (body.get('grant_type') === 'authorization_code') {
      const issued = this.codes.get(body.get('code') ?? '');
      this.codes.delete(body.get('code') ?? '');
      const verifier = body.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!issued || issued.challenge !== challenge) return json(400, { error: 'invalid_grant' });
      return json(200, this.tokens(issued.scope));
    }
    const refresh = body.get('refresh_token') ?? '';
    if (this.mode === 'expired' || !this.refresh.has(refresh))
      return json(400, { error: 'invalid_grant' });
    return json(200, this.tokens(CALENDAR_SCOPE_ALL, refresh));
  }

  /** Expire every access token now (the next call refreshes). */
  expireAccessTokens(): void {
    this.access.clear();
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    if (url.origin !== BASE) throw new TypeError('fake Google: unknown host');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body;
    if (url.pathname === '/token') {
      this.calls.push('token');
      return this.token(new URLSearchParams(String(body ?? '')));
    }
    if (url.pathname === '/revoke') {
      this.calls.push('revoke');
      return json(200, {});
    }
    if (this.mode === 'unavailable') return json(503, { error: { code: 503 } });
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    if (this.mode === 'expired' || !this.access.has(auth.replace(/^Bearer /, '')))
      return json(401, { error: { code: 401 } });
    const path = url.pathname.replace('/calendar/v3', '');
    if (method === 'GET' && path === '/users/me/calendarList') {
      this.calls.push('calendarList');
      return json(200, { items: CALENDARS });
    }
    if (method === 'POST' && path === '/freeBusy') {
      this.calls.push('freeBusy');
      const request = JSON.parse(String(body)) as { items: Array<{ id: string }> };
      const calendars: Record<string, unknown> = {};
      for (const item of request.items)
        calendars[item.id] = CALENDARS.some((c) => c.id === item.id)
          ? {
              // Like Google: events in the calendar (also the ones we added) count as busy.
              busy: [
                ...this.busy,
                ...this.events
                  .filter((e) => e.calendarId === item.id)
                  .map((e) => ({ start: e.start, end: e.end })),
              ],
            }
          : { errors: [{ reason: 'notFound' }], busy: [] };
      return json(200, { calendars });
    }
    const events = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
    if (events) {
      const calendarId = decodeURIComponent(events[1]!);
      const calendar = CALENDARS.find((c) => c.id === calendarId);
      if (!calendar) return json(404, { error: { code: 404 } });
      if (method === 'POST' && !events[2]) {
        this.calls.push('insertEvent');
        if (calendar.accessRole === 'reader') return json(403, { error: { code: 403 } });
        const event = JSON.parse(String(body)) as {
          id: string;
          summary: string;
          description: string;
          start: { dateTime: string; timeZone: string };
          end: { dateTime: string };
        };
        if (this.events.some((e) => e.calendarId === calendarId && e.id === event.id))
          return json(409, { error: { code: 409 } });
        this.events.push({
          calendarId,
          id: event.id,
          summary: event.summary,
          description: event.description,
          start: event.start.dateTime,
          end: event.end.dateTime,
          timeZone: event.start.timeZone,
        });
        return json(200, { id: event.id, status: 'confirmed' });
      }
      if (method === 'GET' && events[2]) {
        this.calls.push('getEvent');
        const id = decodeURIComponent(events[2]);
        const found = this.events.find((e) => e.calendarId === calendarId && e.id === id);
        return found ? json(200, { id, status: 'confirmed' }) : json(404, { error: { code: 404 } });
      }
    }
    return json(404, { error: { code: 404 } });
  };
}

const CALENDAR_SCOPE_ALL = GOOGLE_SCOPES.join(' ');
