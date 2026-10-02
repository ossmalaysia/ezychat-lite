import { describe, it, expect, afterEach } from 'vitest';
import { SecretBox, randomToken, sha256 } from './secret.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'wati-secret-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('SecretBox', () => {
  it('roundtrips', () => {
    const box = SecretBox.loadOrCreate(join(tmp(), 'secret.key'));
    const blob = box.encrypt('hello world');
    expect(blob).not.toContain('hello');
    expect(box.decrypt(blob)).toBe('hello world');
  });

  it('detects tampering', () => {
    const box = SecretBox.loadOrCreate(join(tmp(), 'secret.key'));
    const blob = box.encrypt('secret value');
    const [iv, tag, ct] = blob.split('.');
    const buf = Buffer.from(ct!, 'base64');
    buf[0] = buf[0]! ^ 0xff;
    expect(() => box.decrypt(`${iv}.${tag}.${buf.toString('base64')}`)).toThrow();
  });

  it('reuses the same key file', () => {
    const file = join(tmp(), 'secret.key');
    const a = SecretBox.loadOrCreate(file);
    const keyBytes = readFileSync(file);
    expect(keyBytes.length).toBe(32);
    const b = SecretBox.loadOrCreate(file);
    expect(b.decrypt(a.encrypt('x'))).toBe('x');
    expect(readFileSync(file).equals(keyBytes)).toBe(true);
  });
});

describe('helpers', () => {
  it('randomToken is base64url', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(randomToken(9)).toHaveLength(12);
  });
  it('sha256 hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
