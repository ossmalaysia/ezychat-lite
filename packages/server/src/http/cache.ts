import type { FastifyInstance } from 'fastify';

/** Vite's default content fingerprint is eight URL-safe characters before the extension. */
const FINGERPRINTED_ASSET = /^assets\/(?:[^/]+\/)*[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

export function staticCacheControl(relativePath: string): string {
  const base = relativePath.replace(/\\/g, '/').replace(/\.(?:br|gz|deflate)$/, '');
  return FINGERPRINTED_ASSET.test(base) ? 'public, max-age=31536000, immutable' : 'no-cache';
}

/** Private API responses are not reusable unless a route explicitly permits private caching. */
export function registerApiCacheHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    const path = request.url.split('?')[0] ?? '/';
    if ((path === '/api' || path.startsWith('/api/')) && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  });
}
