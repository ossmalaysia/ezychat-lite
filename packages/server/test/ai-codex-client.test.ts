import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { CodexClient, CODEX_ERROR } from '../src/ai/codex-client.js';

const childMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: childMock.spawn }));
let child: EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};
let client: CodexClient;
let writes: Array<Record<string, unknown>>;
beforeEach(() => {
  writes = [];
  child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  child.stdin.on('data', (chunk: Buffer) => writes.push(JSON.parse(chunk.toString())));
  childMock.spawn.mockReturnValue(child);
  client = new CodexClient('/app/codex', ['app-server'], '/private/workspace', {});
});
afterEach(() => client.close());
const receive = (value: unknown) => child.stdout.write(`${JSON.stringify(value)}\n`);

it('initializes official stdio protocol and correlates responses', async () => {
  const result = client.initialize();
  expect(writes[0]).toMatchObject({
    id: 1,
    method: 'initialize',
    params: { capabilities: { experimentalApi: false } },
  });
  receive({ id: 1, result: { userAgent: 'ezychat-lite/0.114.0 (Windows)' } });
  await result;
  expect(writes[1]).toMatchObject({ method: 'initialized' });
});
it('fails closed on an unverified helper version before enabling customer threads', async () => {
  const result = client.initialize();
  receive({ id: 1, result: { userAgent: 'ezychat-lite/0.115.0 (Windows)' } });
  await expect(result).rejects.toThrow('bundled Codex 0.114.0');
  expect(child.kill).toHaveBeenCalled();
  expect(writes).toHaveLength(1);
});
it.each([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
])('rejects %s', (method) => {
  receive({ id: 'provider-request', method, params: { command: 'read secrets' } });
  expect(writes[0]).toEqual({ id: 'provider-request', result: { decision: 'decline' } });
});
it.each(['item/tool/call', 'item/tool/requestUserInput', 'unknown/newTool'])(
  'rejects unrecognized or dynamic actions %s',
  (method) => {
    receive({ id: 'provider-request', method, params: {} });
    expect(writes[0]).toEqual({
      id: 'provider-request',
      error: { code: -32601, message: 'Tools are disabled for the AI member' },
    });
  },
);
it('does not expose upstream error details or stderr', async () => {
  const result = client.request('account/read');
  child.stderr.write('SECRET OAuth URL, key and customer content');
  receive({ id: 1, error: { message: 'SECRET provider credentials' } });
  await expect(result).rejects.toThrow(CODEX_ERROR);
  expect(writes).toHaveLength(1);
});
it('rejects pending requests after helper exit or malformed messages', async () => {
  const result = client.request('account/read');
  child.stdout.write('not json\n');
  await expect(result).rejects.toThrow(CODEX_ERROR);
  expect(child.kill).toHaveBeenCalled();
});
it.each([null, ['invalid'], 'invalid'])(
  'fails closed on non-object protocol messages %j',
  async (value) => {
    const result = client.request('account/read');
    receive(value);
    await expect(result).rejects.toThrow(CODEX_ERROR);
    expect(child.kill).toHaveBeenCalled();
  },
);
it('bounds request time and kills the helper on timeout', async () => {
  vi.useFakeTimers();
  const result = client.request('account/read', {}, 1000);
  const assertion = expect(result).rejects.toThrow(CODEX_ERROR);
  await vi.advanceTimersByTimeAsync(1001);
  await assertion;
  expect(child.kill).toHaveBeenCalled();
  vi.useRealTimers();
});
