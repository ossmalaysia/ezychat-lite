import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import type { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWaAdapter } from '@wa-team-inbox/wa';
import { acquireLock } from './lock.js';
import { startServer } from './main.js';

let dir: string;
let blocker: Server | null = null;

afterEach(async () => {
  if (blocker) await new Promise<void>((r) => blocker!.close(() => r()));
  blocker = null;
  // let the async file logger (pino-roll) finish before removing its directory
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('startServer', () => {
  it('releases its process handlers and data lock after an idempotent normal close', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wati-main-'));
    const emitter: EventEmitter = process;
    const events = ['uncaughtException', 'unhandledRejection', 'SIGINT', 'SIGTERM'] as const;
    const before = events.map((event) => emitter.listeners(event));
    const server = await startServer(
      {
        dataDir: dir,
        port: 0,
        host: '127.0.0.1',
        mode: 'dev',
        fakeWa: true,
        webDistDir: null,
        version: 'test',
        portExplicit: true,
        hostExplicit: true,
      },
      { wa: new FakeWaAdapter() },
    );
    try {
      events.forEach((event, index) =>
        expect(process.listenerCount(event)).toBe(before[index]!.length + 1),
      );
    } finally {
      await Promise.all([server.close(), server.close()]);
    }
    events.forEach((event, index) => expect(emitter.listeners(event)).toEqual(before[index]));
    expect(() => acquireLock(dir).release()).not.toThrow();
  });
  it('cleans up (services, lock, process handlers) when listen fails', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wati-main-'));
    blocker = createServer();
    await new Promise<void>((r) => blocker!.listen(0, '127.0.0.1', () => r()));
    const port = (blocker.address() as { port: number }).port;
    const before = process.listenerCount('uncaughtException');
    await expect(
      startServer(
        {
          dataDir: dir,
          port,
          host: '127.0.0.1',
          mode: 'dev',
          fakeWa: true,
          webDistDir: null,
          version: 'test',
          portExplicit: true,
          hostExplicit: true,
        },
        { wa: new FakeWaAdapter() },
      ),
    ).rejects.toThrow(/EADDRINUSE|address already in use/i);
    expect(process.listenerCount('uncaughtException')).toBe(before);
    // the data-dir lock was released
    expect(() => acquireLock(dir).release()).not.toThrow();
  });
});
