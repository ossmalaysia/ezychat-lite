import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type z } from 'zod';
import { ErrorCode } from '@wa-team-inbox/shared';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const errors = {
  unauthorized: (msg = 'Not signed in') => new HttpError(401, ErrorCode.UNAUTHORIZED, msg),
  forbidden: (msg = 'Forbidden') => new HttpError(403, ErrorCode.FORBIDDEN, msg),
  notFound: (what = 'Resource') => new HttpError(404, ErrorCode.NOT_FOUND, `${what} not found`),
  validation: (msg: string) => new HttpError(400, ErrorCode.VALIDATION, msg),
  conflict: (msg: string) => new HttpError(409, ErrorCode.CONFLICT, msg),
  rateLimited: (retryAfterSec: number) =>
    new HttpError(429, ErrorCode.RATE_LIMITED, `Too many attempts, retry in ${retryAfterSec}s`, {
      'retry-after': String(Math.max(1, Math.ceil(retryAfterSec))),
    }),
  waUnavailable: (msg = 'WhatsApp is not connected') => new HttpError(503, ErrorCode.WA_UNAVAILABLE, msg),
  badOrigin: () => new HttpError(403, ErrorCode.BAD_ORIGIN, 'Origin does not match host'),
};

function formatZod(e: ZodError): string {
  return e.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

/** Parses data with a zod schema; throws a 400 validation HttpError on failure. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw errors.validation(formatZod(r.error));
  return r.data;
}

export function sendError(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  return reply.status(status).type('application/json').send({ error: { code, message } });
}

/** Fastify error handler: HttpError → its status; ZodError → 400; fastify client errors → their status; else 500. */
export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (err instanceof HttpError) {
    if (err.headers) reply.headers(err.headers);
    return sendError(reply, err.status, err.code, err.message);
  }
  if (err instanceof ZodError) return sendError(reply, 400, ErrorCode.VALIDATION, formatZod(err));
  if ((err as { code?: string }).code === 'wa_unavailable') {
    return sendError(reply, 503, ErrorCode.WA_UNAVAILABLE, err.message);
  }
  const status = (err as FastifyError).statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const code =
      status === 413 ? 'payload_too_large' : status === 404 ? ErrorCode.NOT_FOUND : status === 429 ? ErrorCode.RATE_LIMITED : ErrorCode.VALIDATION;
    return sendError(reply, status, code, err.message);
  }
  req.log.error({ err }, 'unhandled error');
  return sendError(reply, 500, 'internal', 'Internal server error');
}
