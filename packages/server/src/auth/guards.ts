import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { User } from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import { errors } from '../http/errors.js';
import type { AuthService } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    sessionToken?: string;
  }
}

export const SESSION_COOKIE = 'sid';
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

/** Paths a user with must_change_password may still reach. */
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/me', '/api/auth/change-password', '/api/auth/logout']);

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
    secure,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/', secure });
}

/** Returns the auth service; throws if initAuth has not run. */
export function getAuth(ctx: AppContext): AuthService {
  const svc = ctx.services.auth;
  if (!svc) throw new Error('auth service not initialized');
  return svc;
}
const authService = getAuth;

/** Resolves the session cookie into req.user (no enforcement). Returns the user or null. */
export function loadUser(ctx: AppContext, req: FastifyRequest): User | null {
  if (req.user) return req.user;
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const user = authService(ctx).resolveSession(token);
  if (!user) return null;
  req.user = user;
  req.sessionToken = token;
  return user;
}

function enforceUser(ctx: AppContext, req: FastifyRequest): User {
  const user = loadUser(ctx, req);
  if (!user) throw errors.unauthorized();
  if (user.mustChangePassword) {
    const path = req.url.split('?')[0] ?? '';
    if (!PASSWORD_CHANGE_ALLOWED.has(path)) throw errors.forbidden('Password change required');
  }
  return user;
}

/** preHandler: requires a valid session cookie; 401 otherwise. */
export function requireUser(ctx: AppContext): preHandlerHookHandler {
  return async function requireUserHook(req) {
    enforceUser(ctx, req);
  };
}

/** preHandler: requires a valid session of an admin; 401/403 otherwise. */
export function requireAdmin(ctx: AppContext): preHandlerHookHandler {
  return async function requireAdminHook(req) {
    const user = enforceUser(ctx, req);
    if (user.role !== 'admin') throw errors.forbidden('Admin only');
  };
}
