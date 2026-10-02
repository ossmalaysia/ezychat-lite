import type { FastifyInstance } from 'fastify';
import { ChangePasswordBody, ErrorCode, LoginBody } from '@wa-team-inbox/shared';
import { clearSessionCookie, getAuth, requireUser, SESSION_COOKIE, setSessionCookie } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { clientIp, isHttps } from '../http/client-ip.js';
import { HttpError, parse } from '../http/errors.js';

export default async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = getAuth(ctx);

  app.post('/auth/login', async (req, reply) => {
    const body = parse(LoginBody, req.body);
    const ip = clientIp(req);
    let user;
    try {
      user = await auth.verifyLogin(body.username, body.password, ip);
    } catch (err) {
      if (err instanceof HttpError) {
        audit(ctx.db, {
          userId: null,
          action: 'auth.login_failed',
          ip,
          meta: { username: body.username.slice(0, 64), reason: err.code === ErrorCode.RATE_LIMITED ? 'rate_limited' : 'invalid' },
        });
      }
      throw err;
    }
    const token = auth.createSession(user.id, { ip, userAgent: String(req.headers['user-agent'] ?? '') });
    setSessionCookie(reply, token, isHttps(req));
    audit(ctx.db, { userId: user.id, action: 'auth.login', ip });
    return user;
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const user = auth.resolveSession(token);
      auth.destroySession(token);
      if (user) audit(ctx.db, { userId: user.id, action: 'auth.logout', ip: clientIp(req) });
    }
    clearSessionCookie(reply, isHttps(req));
    return { ok: true };
  });

  app.post('/auth/change-password', { preHandler: requireUser(ctx) }, async (req) => {
    const user = req.user!;
    const body = parse(ChangePasswordBody, req.body);
    await auth.changePassword(user.id, body.currentPassword, body.newPassword);
    auth.revokeOthers(user.id, req.sessionToken!);
    audit(ctx.db, { userId: user.id, action: 'auth.change_password', ip: clientIp(req) });
    return auth.getUser(user.id);
  });

  app.get('/me', { preHandler: requireUser(ctx) }, async (req) => req.user!);
}
