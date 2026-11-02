/**
 * In-process stand-in for Google (sign-in and Sheets), used ONLY when the server runs with
 * `--fake-wa` (tests, e2e, Dev Builds) and no Google app is configured. Nothing here touches the
 * network: `fetch` answers the same requests SheetsClient sends to the fake base URLs.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { GoogleEndpoints } from '../google-calendar/google.js';
import type { FakeSignIn } from '../google-account.js';
import { SHEETS_SCOPES } from './sheets.js';

const BASE = 'https://fake-google-sheets.invalid';
export const FAKE_SHEETS_ENDPOINTS: GoogleEndpoints = {
  auth: `${BASE}/o/oauth2/v2/auth`,
  token: `${BASE}/token`,
  api: `${BASE}/v4`,
  revoke: `${BASE}/revoke`,
};
export const FAKE_SHEETS_APP = { clientId: 'fake-client', clientSecret: 'fake-secret' };
export const FAKE_SHEETS_ACCOUNT = 'demo.sheets@example.com';
/** The demo spreadsheet: paste this id (or a link with it) on the Settings tab. */
export const FAKE_SPREADSHEET_ID = 'demo-price-list-0000000000000000000';

export type FakeSheetsMode = 'ok' | 'expired' | 'unavailable';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fakeJwt = (payload: object) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

function demoSheets(): Map<string, { name: string; tabs: Map<string, string[][]> }> {
  return new Map([
    [
      FAKE_SPREADSHEET_ID,
      {
        name: 'Demo price list',
        tabs: new Map([
          [
            'Prices',
            [
              ['Item', 'Price (RM)', 'In stock', 'Notes'],
              ['Nasi lemak set', '12.90', 'Yes', 'With fried chicken'],
              ['Teh tarik', '3.50', 'Yes', ''],
              ['Durian cake (whole)', '88.00', 'No', 'Back in stock on Friday'],
              ['Catering for 20', '450.00', 'Yes', 'Order 3 days ahead'],
            ],
          ],
          ['Leads', []],
        ]),
      },
    ],
  ]);
}

export class FakeGoogleSheets implements FakeSignIn {
  mode: FakeSheetsMode = 'ok';
  /** Spreadsheets by id; tabs by title, rows of text. */
  readonly sheets = demoSheets();
  /** Requests answered, by kind (tests check what was asked, never the network). */
  readonly calls: string[] = [];
  private readonly codes = new Map<string, { challenge: string; scope: string }>();
  private readonly access = new Set<string>();
  private readonly refresh = new Set<string>();

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
      id_token: fakeJwt({ email: FAKE_SHEETS_ACCOUNT }),
    };
  }

  private token(body: URLSearchParams): Response {
    if (this.mode === 'unavailable') return json(503, { error: 'backend_error' });
    if (body.get('grant_type') === 'authorization_code') {
      const code = body.get('code') ?? '';
      const issued = this.codes.get(code);
      this.codes.delete(code);
      const challenge = createHash('sha256')
        .update(body.get('code_verifier') ?? '')
        .digest('base64url');
      if (!issued || issued.challenge !== challenge) return json(400, { error: 'invalid_grant' });
      return json(200, this.tokens(issued.scope));
    }
    const refresh = body.get('refresh_token') ?? '';
    if (this.mode === 'expired' || !this.refresh.has(refresh))
      return json(400, { error: 'invalid_grant' });
    return json(200, this.tokens(SHEETS_SCOPES.join(' '), refresh));
  }

  /** Expire every access token now (the next call refreshes). */
  expireAccessTokens(): void {
    this.access.clear();
  }

  /** The rows of one tab (tests and the dev route). */
  rows(spreadsheetId: string, tab: string): string[][] {
    return this.sheets.get(spreadsheetId)?.tabs.get(tab) ?? [];
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    if (url.origin !== BASE) throw new TypeError('fake Google Sheets: unknown host');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.pathname === '/token') {
      this.calls.push('token');
      return this.token(new URLSearchParams(String(init?.body ?? '')));
    }
    if (url.pathname === '/revoke') {
      this.calls.push('revoke');
      return json(200, {});
    }
    if (this.mode === 'unavailable') return json(503, { error: { code: 503 } });
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    if (this.mode === 'expired' || !this.access.has(auth.replace(/^Bearer /, '')))
      return json(401, { error: { code: 401 } });
    const match = /^\/v4\/spreadsheets\/([^/]+)(?:\/values\/([^/]+?)(:append)?)?$/.exec(
      url.pathname,
    );
    const sheet = match ? this.sheets.get(decodeURIComponent(match[1]!)) : undefined;
    if (!match || !sheet) return json(404, { error: { code: 404 } });
    if (!match[2] && method === 'GET') {
      this.calls.push('spreadsheet');
      return json(200, {
        properties: { title: sheet.name },
        sheets: [...sheet.tabs].map(([title, rows]) => ({
          properties: {
            title,
            sheetType: 'GRID',
            gridProperties: { rowCount: Math.max(1000, rows.length) },
          },
        })),
      });
    }
    const range = decodeURIComponent(match[2] ?? '');
    const tabName = /^'((?:[^']|'')*)'!/.exec(range)?.[1]?.replace(/''/g, "'");
    const tab = tabName !== undefined ? sheet.tabs.get(tabName) : undefined;
    if (!tab) return json(400, { error: { code: 400, message: 'Unable to parse range' } });
    if (match[3] && method === 'POST') {
      this.calls.push('append');
      if (url.searchParams.get('valueInputOption') !== 'RAW')
        return json(400, { error: { code: 400 } });
      const body = JSON.parse(String(init?.body)) as { values: string[][] };
      tab.push(...body.values.map((row) => row.map(String)));
      return json(200, { updates: { updatedRows: body.values.length } });
    }
    if (!match[3] && method === 'GET') {
      this.calls.push('values');
      return json(200, { range, majorDimension: 'ROWS', ...(tab.length ? { values: tab } : {}) });
    }
    return json(404, { error: { code: 404 } });
  };
}
