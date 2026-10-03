import { describe, expect, it } from 'vitest';
import { isTransientNetworkError } from './transient-error.js';

const withCode = (msg: string, code: string) => Object.assign(new Error(msg), { code });

describe('isTransientNetworkError', () => {
  it.each(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'])(
    'direct %s is transient',
    (code) => {
      expect(isTransientNetworkError(withCode('x', code))).toBe(true);
    },
  );

  it('undici "TypeError: terminated" caused by ECONNRESET is transient', () => {
    const err = new TypeError('terminated', { cause: withCode('read ECONNRESET', 'ECONNRESET') });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it('walks a nested cause chain (getaddrinfo ENOTFOUND)', () => {
    const inner = withCode('getaddrinfo ENOTFOUND a.whatsapp.net', 'ENOTFOUND');
    const mid = new Error('fetch failed', { cause: inner });
    expect(isTransientNetworkError(new Error('download failed', { cause: mid }))).toBe(true);
  });

  it('AbortError with a network cause is transient', () => {
    const err = Object.assign(new Error('aborted', { cause: withCode('x', 'ETIMEDOUT') }), { name: 'AbortError' });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it('ordinary errors stay fatal', () => {
    expect(isTransientNetworkError(new TypeError('undefined is not a function'))).toBe(false);
    expect(isTransientNetworkError(new TypeError('terminated'))).toBe(false);
    expect(isTransientNetworkError(withCode('disk', 'ENOSPC'))).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError('ECONNRESET')).toBe(false);
  });

  it('survives a cyclic cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(isTransientNetworkError(a)).toBe(false);
  });
});
