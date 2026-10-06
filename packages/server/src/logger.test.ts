import { Writable } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';
import { createLogger } from './logger.js';

const captured = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock('pino-roll', () => ({
  default: async () =>
    new Writable({
      write(chunk, _encoding, done) {
        captured.lines.push(String(chunk));
        done();
      },
    }),
}));
beforeEach(() => {
  captured.lines = [];
});

it('redacts actual history keys and credentials from child loggers while preserving diagnostic fields', async () => {
  const handle = await createLogger({ dataDir: 'isolated-mocked-logs', stdout: false });
  handle.log.child({ mod: 'wa' }).info(
    {
      histNotification: { mediaKey: 'history-secret', timestamp: 123 },
      password: 'password-secret',
      credentials: { apiToken: 'token-secret' },
      req: { headers: { authorization: 'Bearer auth-secret', cookie: 'session-secret' } },
      res: { headers: { 'set-cookie': 'new-session-secret' } },
    },
    'safe diagnostics',
  );
  handle.close();
  const output = captured.lines.join('');
  for (const secret of [
    'history-secret',
    'password-secret',
    'token-secret',
    'auth-secret',
    'session-secret',
  ]) {
    expect(output).not.toContain(secret);
  }
  const row = JSON.parse(output.trim());
  expect(row.histNotification).toEqual({ mediaKey: '[REDACTED]', timestamp: 123 });
  expect(row.mod).toBe('wa');
  expect(row.msg).toBe('safe diagnostics');
});

it('scrubs OAuth addresses, codes, bearer tokens and JWTs from nested fields and errors', async () => {
  const handle = await createLogger({ dataDir: 'isolated-mocked-logs', stdout: false });
  const jwtLike = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJzZWNyZXQtc3ViIn0.c2lnbmF0dXJlLXNlY3JldA';
  handle.log.child({ mod: 'ai' }).warn(
    {
      event: 'chatgpt_login_paste_rejected',
      status: 400,
      detail: {
        pastedUrl: 'http://localhost:1455/auth/callback?code=paste-secret&state=state-secret',
      },
      note: 'opened https://auth.openai.com/oauth/authorize?client_id=x&state=authz-state&code_challenge=challenge-secret',
      err: new Error(
        `exchange failed for http://127.0.0.1:1455/auth/callback?code=err-code-secret with Bearer opaque-bearer-secret ${jwtLike}`,
      ),
    },
    'ChatGPT sign-in failed',
  );
  handle.log.error(new Error('top-level http://localhost:1455/auth/callback?code=top-secret'));
  handle.close();
  const output = captured.lines.join('');
  for (const secret of [
    'paste-secret',
    'state-secret',
    'authz-state',
    'challenge-secret',
    'err-code-secret',
    'opaque-bearer-secret',
    jwtLike,
    'top-secret',
  ])
    expect(output).not.toContain(secret);
  const [row, top] = output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(row).toMatchObject({
    mod: 'ai',
    event: 'chatgpt_login_paste_rejected',
    status: 400,
    msg: 'ChatGPT sign-in failed',
  });
  expect(row.detail.pastedUrl).toBe('[REDACTED]');
  expect(row.err.message).toContain('/auth/callback?[REDACTED]');
  expect(top.err.message).toContain('top-level');
});
