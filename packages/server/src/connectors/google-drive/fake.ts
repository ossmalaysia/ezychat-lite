/**
 * In-process stand-in for Google (sign-in and Drive v3), used ONLY when the server runs with
 * `--fake-wa` (tests, e2e, Dev Builds) and no Google app is configured. Nothing here touches the
 * network: `fetch` answers the same requests DriveClient sends to the fake base URLs. Like
 * `drive.file`, an item answers 404 unless the (fake) picker granted it or the app created it.
 */
import { randomBytes } from 'node:crypto';
import { FakeGoogleAuth, fakeJson as json } from '../google-fake-auth.js';
import { DRIVE_SCOPES, FOLDER_MIME, type DriveEndpoints } from './drive.js';

const BASE = 'https://fake-google-drive.invalid';
export const FAKE_DRIVE_ENDPOINTS: DriveEndpoints = {
  auth: `${BASE}/o/oauth2/v2/auth`,
  token: `${BASE}/token`,
  api: `${BASE}/drive/v3`,
  upload: `${BASE}/upload/drive/v3`,
  revoke: `${BASE}/revoke`,
};
export const FAKE_DRIVE_APP = { clientId: 'fake-client', clientSecret: 'fake-secret' };
export const FAKE_DRIVE_ACCOUNT = 'demo.drive@example.com';
export const FAKE_DRIVE_FOLDER_ID = 'demo-folder-000000000001';
export const FAKE_DRIVE_DOC_ID = 'demo-doc-prices-0000000001';

export interface FakeDriveItem {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: Buffer;
  appProperties: Record<string, string>;
  trashed: boolean;
}

function demoItems(): FakeDriveItem[] {
  const item = (
    id: string,
    name: string,
    mimeType: string,
    parents: string[],
    content = '',
  ): FakeDriveItem => ({
    id,
    name,
    mimeType,
    parents,
    content: Buffer.from(content, 'utf8'),
    appProperties: {},
    trashed: false,
  });
  return [
    item(FAKE_DRIVE_FOLDER_ID, 'EzyChat demo folder', FOLDER_MIME, ['root']),
    item('demo-folder-000000000002', 'Shared documents', FOLDER_MIME, ['root']),
    item(
      FAKE_DRIVE_DOC_ID,
      'Price list',
      'application/vnd.google-apps.document',
      [FAKE_DRIVE_FOLDER_ID],
      'Nasi lemak set RM 12.90\nTeh tarik RM 3.50\nCatering for 20 people RM 450, order 3 days ahead.',
    ),
    item(
      'demo-sheet-stock-000000001',
      'Stock this week',
      'application/vnd.google-apps.spreadsheet',
      [FAKE_DRIVE_FOLDER_ID],
      'Item,In stock\nDurian cake,No (back on Friday)\nKaya toast,Yes',
    ),
    item(
      'demo-text-faq-000000000001',
      'Delivery FAQ.txt',
      'text/plain',
      [FAKE_DRIVE_FOLDER_ID],
      'We deliver in Penang island from 10am to 8pm. Delivery is free above RM 50.',
    ),
    item(
      'demo-image-flyer-000000001',
      'Old flyer.jpg',
      'image/jpeg',
      [FAKE_DRIVE_FOLDER_ID],
      'not really a jpeg',
    ),
  ];
}

interface UploadSession {
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
}

export class FakeGoogleDrive extends FakeGoogleAuth {
  readonly items = new Map<string, FakeDriveItem>(demoItems().map((i) => [i.id, i]));
  /** Picked in the (fake) file picker. */
  readonly granted = new Set<string>();
  /** Created by the app (always reachable with drive.file). */
  readonly created = new Set<string>();
  /** HTTP statuses the next uploads answer instead of storing (e.g. 503). */
  readonly uploadStatuses: number[] = [];
  private readonly sessions = new Map<string, UploadSession>();

  constructor() {
    super(FAKE_DRIVE_ACCOUNT, DRIVE_SCOPES.join(' '));
  }

  /** The fake picker's choice (tests and the dev picker page). */
  grant(id: string): boolean {
    if (!this.items.has(id)) return false;
    this.granted.add(id);
    return true;
  }

  /** Folders the picker shows. */
  folders(): FakeDriveItem[] {
    return [...this.items.values()].filter((i) => i.mimeType === FOLDER_MIME && !i.trashed);
  }

  /** Files of a folder the picker shows (everything in it, like Google's picker). */
  filesIn(folderId: string): FakeDriveItem[] {
    return [...this.items.values()].filter(
      (i) => i.mimeType !== FOLDER_MIME && !i.trashed && i.parents.includes(folderId),
    );
  }

  private reachable(id: string): FakeDriveItem | undefined {
    const item = this.items.get(id);
    return item && (this.granted.has(id) || this.created.has(id)) ? item : undefined;
  }

  private meta(item: FakeDriveItem) {
    return {
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      parents: item.parents,
      trashed: item.trashed,
      ...(item.mimeType.startsWith('application/vnd.google-apps')
        ? {}
        : { size: String(item.content.length) }),
    };
  }

  private add(input: Omit<FakeDriveItem, 'id' | 'trashed'>): FakeDriveItem {
    const id = `fake-${randomBytes(10).toString('hex')}`;
    const item = { ...input, id, trashed: false };
    this.items.set(id, item);
    this.created.add(id);
    return item;
  }

  /** `'X' in parents`, `name = 'Y'`, `appProperties has { key='k' and value='v' }`, mimeType. */
  private matches(item: FakeDriveItem, q: string): boolean {
    const unq = (s: string) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    const parent = /'((?:[^'\\]|\\.)*)' in parents/.exec(q);
    if (parent && !item.parents.includes(unq(parent[1]!))) return false;
    const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q);
    if (name && item.name !== unq(name[1]!)) return false;
    const mime = /mimeType = '((?:[^'\\]|\\.)*)'/.exec(q);
    if (mime && item.mimeType !== unq(mime[1]!)) return false;
    const prop = /key='((?:[^'\\]|\\.)*)' and value='((?:[^'\\]|\\.)*)'/.exec(q);
    if (prop && item.appProperties[unq(prop[1]!)] !== unq(prop[2]!)) return false;
    return !item.trashed;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    if (url.origin !== BASE) throw new TypeError('fake Google Drive: unknown host');
    const method = (init?.method ?? 'GET').toUpperCase();
    // The resumable session URL carries no token (as Google's: the upload id is the key).
    if (url.pathname === '/upload/drive/v3/files' && url.searchParams.has('upload_id')) {
      const session = this.sessions.get(url.searchParams.get('upload_id')!);
      if (!session || method !== 'PUT') return json(404, { error: { code: 404 } });
      this.sessions.delete(url.searchParams.get('upload_id')!);
      this.calls.push('upload');
      const status = this.uploadStatuses.shift();
      if (status) return json(status, { error: { code: status } });
      const body = init?.body;
      const content = body instanceof Uint8Array ? Buffer.from(body) : Buffer.from(String(body));
      const item = this.add({ ...session, content });
      return json(200, { id: item.id });
    }
    const denied = this.authorize(url.pathname, init);
    if (denied) return denied;
    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Partial<UploadSession>;
      const parent = body.parents?.[0];
      if (!parent || !this.reachable(parent)) return json(404, { error: { code: 404 } });
      const uploadId = randomBytes(8).toString('hex');
      this.sessions.set(uploadId, {
        name: String(body.name),
        mimeType: String(body.mimeType),
        parents: [parent],
        appProperties: body.appProperties ?? {},
      });
      return new Response(null, {
        status: 200,
        headers: {
          location: `${BASE}/upload/drive/v3/files?uploadType=resumable&upload_id=${uploadId}`,
        },
      });
    }
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      this.calls.push('list');
      const q = url.searchParams.get('q') ?? '';
      const files = [...this.items.values()]
        .filter((i) => this.reachable(i.id) && this.matches(i, q))
        .map((i) => this.meta(i));
      return json(200, { files });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { name?: string; parents?: string[] };
      const parent = body.parents?.[0];
      if (!parent || !this.reachable(parent)) return json(404, { error: { code: 404 } });
      this.calls.push('createFolder');
      const item = this.add({
        name: String(body.name),
        mimeType: FOLDER_MIME,
        parents: [parent],
        content: Buffer.alloc(0),
        appProperties: {},
      });
      return json(200, { id: item.id });
    }
    const exported = /^\/drive\/v3\/files\/([^/]+)\/export$/.exec(url.pathname);
    if (exported && method === 'GET') {
      const item = this.reachable(decodeURIComponent(exported[1]!));
      if (!item || !item.mimeType.startsWith('application/vnd.google-apps'))
        return json(404, { error: { code: 404 } });
      this.calls.push('export');
      return new Response(new Uint8Array(item.content), { status: 200 });
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (one && method === 'GET') {
      const item = this.reachable(decodeURIComponent(one[1]!));
      if (!item) return json(404, { error: { code: 404 } });
      if (url.searchParams.get('alt') === 'media') {
        this.calls.push('download');
        return new Response(new Uint8Array(item.content), { status: 200 });
      }
      this.calls.push('file');
      return json(200, this.meta(item));
    }
    return json(404, { error: { code: 404 } });
  };
}
