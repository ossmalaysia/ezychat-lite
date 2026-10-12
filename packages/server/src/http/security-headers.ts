import type { FastifyInstance } from 'fastify';

export const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://*.whatsapp.net",
  "media-src 'self' blob:",
  "connect-src 'self' ws: wss:",
  "style-src 'self' 'unsafe-inline'",
  // 'wasm-unsafe-eval' lets the voice note recorder compile its bundled Opus encoder (WebAssembly).
  // It allows WebAssembly compilation only; JavaScript eval and inline scripts stay blocked.
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Adds strict security headers to every response (helmet-like, without the dependency's defaults). */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.hasHeader('content-security-policy')) reply.header('content-security-policy', CSP);
    reply.header('x-frame-options', 'DENY');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    return payload;
  });
}
