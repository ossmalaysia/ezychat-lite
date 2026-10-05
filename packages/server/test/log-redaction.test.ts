import { expect, it } from 'vitest';
import { redactSecretText, scrubLogValue } from '../src/log-redaction.js';

it('redacts JSON-embedded token fields, plain and escaped', () => {
  const plain = redactSecretText(
    '{"refresh_token":"rt-secret","access_token": "at-secret","id_token":"it-secret","code_verifier":"cv-secret","ok":"keep"}',
  );
  expect(plain).not.toMatch(/-secret/);
  expect(plain).toContain('"ok":"keep"');
  const escaped = redactSecretText(String.raw`body {\"refresh_token\":\"rt-secret\",\"x\":1}`);
  expect(escaped).not.toContain('rt-secret');
  expect(escaped).toContain(String.raw`\"x\":1`);
});

it('redacts Bearer tokens but leaves prose alone', () => {
  expect(redactSecretText('Authorization: Bearer abcDEF123456789xyz_-.~+/=')).toBe(
    'Authorization: Bearer [REDACTED]',
  );
  expect(redactSecretText('Bearer secret-bearer')).toBe('Bearer [REDACTED]');
  expect(redactSecretText('the bearer of bad news arrived')).toBe('the bearer of bad news arrived');
  expect(redactSecretText('Bearer token required')).toBe('Bearer token required');
});

it('redacts a JWT whose signature ends in a dash', () => {
  const jwt = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJzZWNyZXQtc3ViIn0.c2lnbmF0dXJl-';
  const out = redactSecretText(`token ${jwt} end`);
  expect(out).toBe('token [REDACTED_JWT] end');
});

it('redacts code= and state= only as URL query parameters', () => {
  expect(redactSecretText('state=connected code=ready')).toBe('state=connected code=ready');
  expect(redactSecretText('GET /cb?code=abc&state=xyz&x=1')).toBe(
    'GET /cb?code=[REDACTED]&state=[REDACTED]&x=1',
  );
  expect(redactSecretText('refresh_token=abc')).toBe('refresh_token=[REDACTED]');
});

it('scrubLogValue truncates deep values, keeps the error type and cause, scrubs URLs', () => {
  let deep: Record<string, unknown> = { leaf: 'code=raw' };
  for (let i = 0; i < 10; i++) deep = { next: deep };
  expect(JSON.stringify(scrubLogValue(deep))).toContain('[Truncated]');
  expect(JSON.stringify(scrubLogValue(deep))).not.toContain('code=raw');

  class OAuthError extends Error {}
  const err = new OAuthError('outer', {
    cause: new Error('inner http://localhost:1455/auth/callback?code=cause-secret'),
  });
  const out = scrubLogValue(err) as { errType: string; cause: { message: string } };
  expect(out.errType).toBe('OAuthError');
  expect(out.cause.message).toContain('/auth/callback?[REDACTED]');
  expect(JSON.stringify(out)).not.toContain('cause-secret');

  expect(scrubLogValue(new URL('http://localhost:1455/auth/callback?code=url-secret'))).toBe(
    'http://localhost:1455/auth/callback?[REDACTED]',
  );
});
