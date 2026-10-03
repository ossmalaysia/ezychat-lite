import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Role, User } from '@wa-team-inbox/shared';
import type { AppContext } from '../src/context.js';
import '../src/auth/index.js';

let seq = 0;

/** Extracts `sid=<token>` from an inject response's set-cookie, or null. */
export function sessionCookieFrom(res: {
  cookies: Array<{ name: string; value: string }>;
}): string | null {
  const c = res.cookies.find((x) => x.name === 'sid');
  return c && c.value ? `sid=${c.value}` : null;
}

/** Headers for an authenticated, same-origin mutating request via app.inject. */
export function authHeaders(cookie: string): Record<string, string> {
  return { cookie, origin: 'http://localhost', host: 'localhost' };
}

/**
 * Creates a user directly through the auth service and logs in over HTTP.
 * Each call logs in from a distinct non-loopback IP so per-IP login limits are not shared between calls.
 */
export async function createUserAndLogin(
  t: { app: FastifyInstance; ctx: AppContext },
  opts?: { username?: string; role?: Role; password?: string },
): Promise<{ user: User; cookie: string; password: string }> {
  seq += 1;
  const username = opts?.username ?? `user${seq}_${randomUUID().slice(0, 8)}`;
  const password = opts?.password ?? 'password123';
  const user = t.ctx.services.auth!.createUser({
    username,
    displayName: username,
    role: opts?.role ?? 'agent',
    password,
    mustChangePassword: false,
  });
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
    remoteAddress: `10.200.${(seq >> 8) & 255}.${seq & 255}`,
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const cookie = sessionCookieFrom(res);
  if (!cookie) throw new Error('login did not set sid cookie');
  return { user, cookie, password };
}
