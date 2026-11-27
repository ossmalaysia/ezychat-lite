import Fastify, { type FastifyError } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErrorCode } from '@ezychat/shared';
import { errorHandler, errors, HttpError } from '../src/http/errors.js';

let app: ReturnType<typeof Fastify> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** One route that throws `err`; answers with the shared error handler. */
async function answerFor(err: Error) {
  app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  app.get('/boom', async () => {
    throw err;
  });
  const r = await app.inject({ method: 'GET', url: '/boom' });
  return {
    status: r.statusCode,
    body: r.json() as { error: { code: string; message: string } },
    headers: r.headers,
  };
}

function clientError(statusCode: number, message = 'client error'): FastifyError {
  return Object.assign(new Error(message), { statusCode, code: 'FST_X' }) as FastifyError;
}

describe('errorHandler', () => {
  it('answers an HttpError with its status, code and headers', async () => {
    const r = await answerFor(errors.rateLimited(2.2));
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(r.headers['retry-after']).toBe('3');
  });

  it('answers a ZodError with 400 validation and the issue paths', async () => {
    const parsed = z.object({ name: z.string() }).safeParse({ name: 1 });
    const r = await answerFor(parsed.error!);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe(ErrorCode.VALIDATION);
    expect(r.body.error.message).toMatch(/^name: /);
  });

  it('answers a wa_unavailable error with 503', async () => {
    const r = await answerFor(Object.assign(new Error('offline'), { code: 'wa_unavailable' }));
    expect(r.status).toBe(503);
    expect(r.body.error).toEqual({ code: ErrorCode.WA_UNAVAILABLE, message: 'offline' });
  });

  it.each([
    [413, 'payload_too_large'],
    [404, ErrorCode.NOT_FOUND],
    [429, ErrorCode.RATE_LIMITED],
    [400, ErrorCode.VALIDATION],
    [415, ErrorCode.VALIDATION],
  ])('maps a Fastify client error %i to %s', async (status, code) => {
    const r = await answerFor(clientError(status, 'too big'));
    expect(r.status).toBe(status);
    expect(r.body.error).toEqual({ code, message: 'too big' });
  });

  it('hides any other error behind a 500 without its message', async () => {
    const r = await answerFor(new Error('secret detail'));
    expect(r.status).toBe(500);
    expect(r.body.error).toEqual({ code: 'internal', message: 'Internal server error' });
  });

  it('treats a 5xx statusCode as an unhandled error', async () => {
    const r = await answerFor(clientError(502, 'upstream'));
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('internal');
  });

  it('keeps HttpError instances recognisable', () => {
    expect(errors.notFound('Chat')).toBeInstanceOf(HttpError);
  });
});
