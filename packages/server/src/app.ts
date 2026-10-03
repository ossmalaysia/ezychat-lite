import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ErrorCode } from '@wa-team-inbox/shared';
import type { AppContext } from './context.js';
import { errorHandler, sendError } from './http/errors.js';
import { contextHostPolicy, createHostHook } from './http/host.js';
import { originHook } from './http/origin.js';
import { registerSecurityHeaders } from './http/security-headers.js';
import { registerApiCacheHeaders, staticCacheControl } from './http/cache.js';
import { registerRoutes } from './routes/index.js';

export const UPLOAD_LIMIT_BYTES = 64 * 1024 * 1024;

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: ctx.log as FastifyBaseLogger,
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });

  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, { limits: { fileSize: UPLOAD_LIMIT_BYTES, files: 1 } });
  registerSecurityHeaders(app);
  registerApiCacheHeaders(app);
  app.addHook('onRequest', createHostHook(contextHostPolicy(ctx)));
  app.addHook('onRequest', originHook);
  app.setErrorHandler(errorHandler);

  await registerRoutes(app, ctx);

  const webDist = ctx.config.webDistDir;
  const hasWeb = webDist !== null && existsSync(join(webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      index: false,
      // Built once with the web bundle, so each request avoids runtime compression work.
      preCompressed: true,
      globIgnore: ['**/*.br', '**/*.gz', '**/*.deflate'],
      setHeaders(res, path) {
        res.header('cache-control', staticCacheControl(relative(webDist, path)));
      },
    });
  }

  app.setNotFoundHandler(async (req, reply) => {
    const path = req.url.split('?')[0] ?? '/';
    const isApi = path === '/api' || path.startsWith('/api/') || path.startsWith('/socket.io');
    if (!isApi && hasWeb && (req.method === 'GET' || req.method === 'HEAD')) {
      // static files (wildcard:false registers only files present at startup), else SPA fallback
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return sendError(reply, 404, ErrorCode.NOT_FOUND, `Route ${req.method} ${path} not found`);
  });

  return app;
}
