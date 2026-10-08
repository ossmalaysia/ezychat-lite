import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@wa-team-inbox/shared';
import {
  createApiTokenService,
  parseBearer,
  type ApiTokenService,
} from '../src/api-tokens/index.js';
import { sha256 } from '../src/crypto/secret.js';
import { makeTestApp, type TestApp } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
let t: TestApp;
let clock: number;
let tokens: ApiTokenService;
let admin: User;
let other: User;

beforeEach(async () => {
  t = await makeTestApp();
  clock = 1_800_000_000_000;
  // A separate instance on a fake clock; the app's own instance keeps its bus listeners too.
  tokens = createApiTokenService(t.ctx, { now: () => clock });
  const auth = t.ctx.services.auth!;
  const create = (username: string, role: 'admin' | 'agent') =>
    auth.createUser({
      username,
      displayName: username,
      role,
      password: 'password123',
      mustChangePassword: false,
    });
  admin = create('owner', 'admin');
  other = create('second', 'admin');
});
afterEach(async () => {
  tokens.shutdown();
  await t.close();
});

describe('api tokens', () => {
  it('stores only the hash and a short prefix, and returns the secret once', () => {
    const { token, secret } = tokens.create(
      admin.id,
      { name: 'Laptop', expiresInDays: 90 },
      '127.0.0.1',
    );
    expect(secret).toMatch(/^ezc_pat_[A-Za-z0-9_-]{43}$/);
    expect(token.prefix).toBe(secret.slice(0, 12));
    expect(token.expiresAt).toBe(clock + 90 * DAY);
    const row = t.ctx.db.prepare('SELECT * FROM api_tokens').get() as Record<string, unknown>;
    expect(row['token_hash']).toBe(sha256(secret));
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(JSON.stringify(tokens.list())).not.toContain(secret);
    const audit = t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'api_token.create'")
      .get() as {
      meta: string;
    };
    expect(audit.meta).not.toContain(secret);
  });

  it('never expires when no expiry is chosen', () => {
    const { token, secret } = tokens.create(admin.id, { name: 'x', expiresInDays: null }, 'ip');
    expect(token.expiresAt).toBeNull();
    clock += 3650 * DAY;
    expect(tokens.resolve(secret).ok).toBe(true);
  });

  it('refuses expired, revoked, unknown and malformed tokens', () => {
    const { token, secret } = tokens.create(admin.id, { name: 'x', expiresInDays: 30 }, 'ip');
    expect(tokens.resolve('nope')).toEqual({ ok: false, reason: 'malformed' });
    expect(tokens.resolve(`ezc_pat_${'A'.repeat(43)}`)).toEqual({ ok: false, reason: 'unknown' });
    clock += 30 * DAY;
    expect(tokens.resolve(secret)).toMatchObject({ ok: false, reason: 'expired' });
    clock -= DAY;
    tokens.revoke(token.id, admin.id, 'ip');
    expect(tokens.resolve(secret)).toMatchObject({ ok: false, reason: 'revoked' });
    expect(tokens.list()).toEqual([]);
    expect(() => tokens.revoke(token.id, admin.id, 'ip')).toThrow(/not found/);
  });

  it("follows the owner's live state: password change, demotion and disabling", () => {
    const { secret } = tokens.create(other.id, { name: 'x', expiresInDays: 90 }, 'ip');
    const db = t.ctx.db;
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(other.id);
    expect(tokens.resolve(secret)).toMatchObject({ ok: false, reason: 'must_change_password' });
    db.prepare('UPDATE users SET must_change_password = 0, role = ? WHERE id = ?').run(
      'agent',
      other.id,
    );
    expect(tokens.resolve(secret)).toMatchObject({ ok: false, reason: 'not_admin' });
    db.prepare("UPDATE users SET role = 'admin', disabled_at = 1 WHERE id = ?").run(other.id);
    expect(tokens.resolve(secret)).toMatchObject({ ok: false, reason: 'user_inactive' });
  });

  it('revokes a user’s tokens when they are disabled or demoted', () => {
    const a = tokens.create(other.id, { name: 'a', expiresInDays: 90 }, 'ip');
    const auth = t.ctx.services.auth!;
    auth.updateUser(other.id, { role: 'agent' }, admin.id);
    expect(tokens.list()).toEqual([]);
    auth.updateUser(other.id, { role: 'admin' }, admin.id);
    expect(tokens.resolve(a.secret)).toMatchObject({ ok: false, reason: 'revoked' });
    const b = tokens.create(other.id, { name: 'b', expiresInDays: 90 }, 'ip');
    auth.updateUser(other.id, { disabled: true }, admin.id);
    expect(tokens.resolve(b.secret).ok).toBe(false);
    expect(tokens.list()).toEqual([]);
  });

  it('records last use at most once a minute', () => {
    const { token, secret } = tokens.create(admin.id, { name: 'x', expiresInDays: 90 }, 'ip');
    const lastUsed = () => tokens.list().find((x) => x.id === token.id)!.lastUsedAt;
    tokens.resolve(secret);
    expect(lastUsed()).toBe(clock);
    const first = clock;
    clock += 30_000;
    tokens.resolve(secret);
    expect(lastUsed()).toBe(first);
    clock += 30_000;
    tokens.resolve(secret);
    expect(lastUsed()).toBe(clock);
  });

  it('only admins can own a token', () => {
    const agent = t.ctx.services.auth!.createUser({
      username: 'agent',
      displayName: 'agent',
      role: 'agent',
      password: 'password123',
      mustChangePassword: false,
    });
    expect(() => tokens.create(agent.id, { name: 'x', expiresInDays: 90 }, 'ip')).toThrow(
      /Admin only/,
    );
  });

  it('parses only well-formed bearer headers', () => {
    const secret = `ezc_pat_${'a'.repeat(43)}`;
    expect(parseBearer(`Bearer ${secret}`)).toBe(secret);
    expect(parseBearer(`bearer  ${secret}`)).toBe(secret);
    expect(parseBearer(secret)).toBeNull();
    expect(parseBearer(`Bearer ${secret}x`)).toBeNull();
    expect(parseBearer(`Basic ${secret}`)).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
  });
});
