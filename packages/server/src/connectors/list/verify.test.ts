import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  iconContentOk,
  iconContentType,
  parseEntries,
  publicKeys,
  signatureValid,
} from './verify.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('connector list checks', () => {
  it('reads only 32-byte keys and verifies with any of them', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
    const keys = publicKeys(['', 'c2hvcnQ=', Buffer.alloc(33).toString('base64'), raw]);
    expect(keys.length).toBe(1);
    const bytes = Buffer.from('{"format":1}');
    const sig = Buffer.from(sign(null, bytes, privateKey).toString('base64'));
    expect(signatureValid(bytes, sig, keys)).toBe(true);
    expect(signatureValid(Buffer.from('{"format":2}'), sig, keys)).toBe(false);
    expect(signatureValid(bytes, Buffer.from('c2hvcnQ='), keys)).toBe(false);
    expect(signatureValid(bytes, Buffer.from('***'), keys)).toBe(false);
    expect(signatureValid(bytes, sig, [])).toBe(false);
  });

  it('accepts plain PNG and SVG icons only', () => {
    const svg = Buffer.from(
      '<?xml version="1.0"?>\n<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>',
    );
    expect(iconContentOk('a.svg', svg)).toBe(true);
    expect(iconContentOk('a.png', PNG)).toBe(true);
    expect(iconContentOk('a.png', svg)).toBe(false);
    expect(iconContentOk('a.svg', PNG)).toBe(false);
    expect(iconContentOk('a.gif', PNG)).toBe(false);
    expect(iconContentOk('a.svg', Buffer.from('<html><body>hi</body></html>'))).toBe(false);
    for (const bad of [
      '<svg><script>alert(1)</script></svg>',
      '<svg><SCRIPT src="x"/></svg>',
      '<svg onload="x()"></svg>',
      '<svg><path d="M1 1" onclick = "x()"/></svg>',
      '<svg><a xlink:href="javascript:x()"/></svg>',
      '<svg><a href="JavaScript :x()"/></svg>',
    ])
      expect(iconContentOk('a.svg', Buffer.from(bad)), bad).toBe(false);
    expect(iconContentType('a.png')).toBe('image/png');
    expect(iconContentType('a.svg')).toBe('image/svg+xml');
  });

  it('counts unknown schema versions and skips invalid entries', () => {
    const good = {
      id: 'good',
      schemaVersion: 1,
      minAppVersion: '0.1.0',
      kind: 'coming_soon',
      editions: ['lite'],
      name: 'Good',
      summary: { en: 's' },
      description: { en: 'd' },
      category: 'other',
    };
    const result = parseEntries([
      good,
      { ...good, id: 'two', schemaVersion: 2 },
      { ...good, id: 'NOPE' },
      null,
      { ...good, schemaVersion: '1' },
    ]);
    expect(result.entries.map((e) => e.id)).toEqual(['good']);
    expect(result.hidden).toBe(1);
    expect(result.skipped).toEqual([null, null, 'good']);
  });
});
