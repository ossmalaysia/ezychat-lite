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
