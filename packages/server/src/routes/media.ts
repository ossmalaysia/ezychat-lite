import type { FastifyInstance } from 'fastify';
import { createReadStream, statSync } from 'node:fs';
import { z } from 'zod';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { errors, parse, sendError } from '../http/errors.js';
import { getMessages } from '../wa-bridge/index.js';

const IdParams = z.object({ msgId: z.string().min(1).max(256) });

// Only passive raster/AV types render inline. Anything else (notably image/svg+xml, which can carry
// script, and text/html) is forced to download so customer-sent files can't run on our origin.
const SAFE_INLINE_MIME = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm|3gpp|quicktime)|audio\/(mpeg|mp4|aac|ogg|webm|amr|wav|x-wav))(;.*)?$/i;

export function contentDisposition(mime: string, name: string | null, id: string): string {
  if (SAFE_INLINE_MIME.test(mime)) return 'inline';
  const fallback = (name || id).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').slice(0, 200) || 'file';
  const encoded = encodeURIComponent(name || id).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Parses a single `bytes=start-end` range. Returns null when absent/unsupported, 'invalid' when unsatisfiable. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-range or other units: serve full content
  const [, s, e] = m;
  let start: number;
  let end: number;
  if (s === '' && e === '') return 'invalid';
  if (s === '') {
    const suffix = Number(e);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === '' ? size - 1 : Math.min(Number(e), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

export default async function mediaRoutes(app: FastifyInstance, ctx: AppContext) {
  const messages = getMessages(ctx);
  app.addHook('preHandler', requireUser(ctx));

  app.get('/media/:msgId', async (req, reply) => {
    const { msgId } = parse(IdParams, req.params);
    // pending (history) media is downloaded on demand here; the first GET may take a while
    const media = await messages.ensureMedia(msgId);
    if (media === 'unavailable') return sendError(reply, 404, 'media_pending', 'Media could not be downloaded from WhatsApp');
    if (!media) throw errors.notFound('Media');
    const size = statSync(media.path).size;
    reply
      .header('content-type', media.mime)
      .header('x-content-type-options', 'nosniff')
      // Defense in depth: even if a scriptable type is opened directly, it runs in an opaque sandbox.
      .header('content-security-policy', "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
      .header('content-disposition', contentDisposition(media.mime, media.name, msgId))
      .header('accept-ranges', 'bytes')
      .header('cache-control', 'private, max-age=86400');

    const range = parseRange(req.headers.range, size);
    if (range === 'invalid') {
      reply.header('content-range', `bytes */${size}`);
      return sendError(reply, 416, 'range_not_satisfiable', 'Requested range not satisfiable');
    }
    if (range) {
      reply
        .status(206)
        .header('content-range', `bytes ${range.start}-${range.end}/${size}`)
        .header('content-length', String(range.end - range.start + 1));
      return reply.send(createReadStream(media.path, { start: range.start, end: range.end }));
    }
    reply.header('content-length', String(size));
    return reply.send(createReadStream(media.path));
  });

  app.post('/media/:msgId/redownload', async (req) => {
    const { msgId } = parse(IdParams, req.params);
    return messages.redownload(msgId);
  });
}
