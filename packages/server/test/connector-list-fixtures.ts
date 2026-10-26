import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

/** Test fixtures for the connector list: a signing key, entries and a fake list server. */

export const BASE = 'https://list.test/connectors/';

export function keyPair(): { publicKey: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return { publicKey: der.subarray(12).toString('base64'), privateKey };
}

export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export const SVG = (stroke = 'currentColor') =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${stroke}"><path d="M4 4h16"/></svg>`,
  );
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('rest of a png'),
]);

export const iconRef = (file: string, bytes: Buffer) => ({
  file,
  sha256: sha256(bytes),
  size: bytes.length,
});

export function entry(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    schemaVersion: 1,
    minAppVersion: '0.1.0',
    kind: 'coming_soon',
    editions: ['lite', 'enterprise'],
    name: `Name ${id}`,
    summary: { en: `Summary of ${id}` },
    description: { en: `Description of ${id}` },
    category: 'other',
    ...extra,
  };
}

/** Serves list-v1.json, its signature and icons/ from memory; records every request. */
export class FakeListServer {
  files = new Map<string, Buffer>();
  calls: string[] = [];
  /** Throws like a network failure. */
  offline = false;
  /** Answers every request with this HTTP status. */
  status: number | null = null;
  /** Extra headers per path (e.g. a content-length). */
  headers = new Map<string, Record<string, string>>();
  /** Holds every answer until release() (concurrency tests). */
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;

  hold() {
    this.gate = new Promise((resolve) => (this.open = resolve));
  }
  release() {
    this.open?.();
    this.gate = null;
  }

  fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    this.calls.push(url);
    if (this.gate) await this.gate;
    if (this.offline) throw new TypeError('fetch failed');
    if (this.status) return new Response('error', { status: this.status });
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
    const body = this.files.get(path);
    if (!body) return new Response('not found', { status: 404 });
    return new Response(new Uint8Array(body), { status: 200, headers: this.headers.get(path) });
  }) as typeof fetch;

  /** Publishes a signed list (format 1 unless given). Returns the exact list bytes. */
  publish(options: {
    sequence: number;
    entries: unknown[];
    key: KeyObject;
    icons?: Record<string, Buffer>;
    format?: number;
    raw?: Buffer;
  }): Buffer {
    const bytes =
      options.raw ??
      Buffer.from(
        JSON.stringify({
          format: options.format ?? 1,
          generatedAt: '2026-10-27T10:00:00.000Z',
          sequence: options.sequence,
          entries: options.entries,
        }),
      );
    this.files.set('list-v1.json', bytes);
    this.files.set(
      'list-v1.json.sig',
      Buffer.from(sign(null, bytes, options.key).toString('base64') + '\n'),
    );
    for (const [file, icon] of Object.entries(options.icons ?? {}))
      this.files.set(`icons/${file}`, icon);
    return bytes;
  }

  iconCalls() {
    return this.calls.filter((url) => url.includes('/icons/')).length;
  }
}
