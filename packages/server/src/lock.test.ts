import { describe, it, expect, afterEach } from 'vitest';
import { acquireLock, LockedError } from './lock.js';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'wati-lock-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('second acquire throws LockedError while first is held', () => {
    const dir = tmp();
    const l = acquireLock(dir);
    expect(() => acquireLock(dir)).toThrow(LockedError);
    l.release();
    expect(existsSync(join(dir, 'server.lock'))).toBe(false);
    acquireLock(dir).release();
  });

  it('takes over a stale lock (dead pid)', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'server.lock'), '999999999');
    acquireLock(dir).release();
  });

  it('takes over a garbage lock file', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'server.lock'), 'not-a-pid');
    acquireLock(dir).release();
  });
});
