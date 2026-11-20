import type { FastifyInstance } from 'fastify';
import {
  ChangePasswordBody,
  ErrorCode,
  LoginBody,
  PatchMeBody,
  type MeResponse,
  type User,
} from '@ezychat/shared';
import {
  clearSessionCookie,
  getAuth,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
} from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { clientIp, isHttps } from '../http/client-ip.js';
import { errors, HttpError, parse } from '../http/errors.js';

export default async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = getAuth(ctx);

  app.post('/auth/login', async (req, reply) => {
    const body = parse(LoginBody, req.body);
    const ip = clientIp(req);
    let login;
    try {
      login = await auth.login(body.username, body.password, {
        ip,
        userAgent: String(req.headers['user-agent'] ?? ''),
      });
    } catch (err) {
      if (err instanceof HttpError) {
        audit(ctx.db, {
          userId: null,
          action: 'auth.login_failed',
          ip,
          meta: {
            username: body.username.slice(0, 64),
            reason: err.code === ErrorCode.RATE_LIMITED ? 'rate_limited' : 'invalid',
          },
        });
      }
      throw err;
    }
    const { user, token } = login;
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
    await auth.changePassword(user.id, body.currentPassword, body.newPassword, req.sessionToken!);
    auth.revokeOthers(user.id, req.sessionToken!);
    audit(ctx.db, { userId: user.id, action: 'auth.change_password', ip: clientIp(req) });
    return auth.getUser(user.id);
  });

  // Live translate adds My language and "Send without preview" to the signed-in user's own answer.
  const me = (user: User): MeResponse => {
    const prefs = ctx.services.liveTranslate?.prefs(user.id);
    return {
      ...user,
      translateLanguage: prefs?.translateLanguage ?? null,
      sendWithoutPreview: prefs?.sendWithoutPreview ?? false,
    };
  };

  app.get('/me', { preHandler: requireUser(ctx) }, async (req) => me(req.user!));

  // Self-service preferences only; role, name and password changes have their own guarded routes.
  app.patch('/me', { preHandler: requireUser(ctx) }, async (req) => {
    const body = parse(PatchMeBody, req.body);
    const user =
      body.locale !== undefined
        ? auth.setLocale(req.user!.id, body.locale)
        : auth.getUser(req.user!.id);
    if (!user) throw errors.notFound('User');
    if (body.translateLanguage !== undefined || body.sendWithoutPreview !== undefined)
      ctx.services.liveTranslate?.setPrefs(
        user.id,
        {
          ...(body.translateLanguage !== undefined
            ? { translateLanguage: body.translateLanguage }
            : {}),
          ...(body.sendWithoutPreview !== undefined
            ? { sendWithoutPreview: body.sendWithoutPreview }
            : {}),
        },
        { userId: user.id, ip: clientIp(req) },
      );
    return me(user);
  });
}
