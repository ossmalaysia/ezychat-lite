import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeWaAdapter } from '@ezychat/wa';
import { openDb, type DB } from '../db/index.js';
import { silentLogger } from '../logger.js';
import { InboxConnections, defaultAdapterFactory } from './connections.js';
import { InboxRepo } from './repo.js';

let dir: string;
let db: DB | null = null;
afterEach(() => {
  db?.close();
  db = null;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function setup(): InboxRepo {
  dir = mkdtempSync(join(tmpdir(), 'wati-conns-'));
  db = openDb(join(dir, 'app.db'));
  return new InboxRepo(db);
}

describe('InboxConnections', () => {
  it('builds Baileys adapters on each inbox folder outside fake mode', async () => {
    const repo = setup();
    const create = defaultAdapterFactory({
      dataDir: dir,
      fakeWa: false,
      historyDays: 3,
      log: silentLogger(),
    });
    const one = await create(repo.get(1)!);
    const two = await create(repo.insert('Two', repo.nextTone(), 1));
    expect(one).not.toBeInstanceOf(FakeWaAdapter);
    expect(two).not.toBe(one);
    expect(two.status.state).toBe('disconnected');
  });

  it('gives each fake inbox its own number', async () => {
    const repo = setup();
    const create = defaultAdapterFactory({
      dataDir: dir,
      fakeWa: true,
      historyDays: 3,
      log: silentLogger(),
    });
    const two = (await create(repo.insert('Two', repo.nextTone(), 1))) as FakeWaAdapter;
    await two.connect();
    expect(two.status.me).toEqual({ jid: '60000000002@s.whatsapp.net', name: 'Two' });
    expect(two.simulateIncoming({ chatJid: 'a@s.whatsapp.net', body: 'x' }).id).toMatch(/^FAKE2-/);
  });

  it('refuses a limit below one', () => {
    const repo = setup();
    const primary = new FakeWaAdapter();
    expect(
      () =>
        new InboxConnections({
          repo,
          maxInboxes: 0,
          log: silentLogger(),
          primary,
          create: () => Promise.resolve(primary),
        }),
    ).toThrow(/maxInboxes/);
  });

  it('still drops an inbox whose logout fails and logs failed disconnects', async () => {
    const repo = setup();
    const warn = vi.fn();
    const log = { ...silentLogger(), warn, error: vi.fn() } as unknown as ReturnType<
      typeof silentLogger
    >;
    const two = new FakeWaAdapter();
    vi.spyOn(two, 'logout').mockRejectedValue(new Error('offline'));
    const primary = new FakeWaAdapter();
    vi.spyOn(primary, 'disconnect').mockRejectedValue(new Error('stuck'));
    const conns = new InboxConnections({
      repo,
      maxInboxes: 2,
      log,
      primary,
      create: () => Promise.resolve(two),
    });
    repo.insert('Two', repo.nextTone(), 1);
    await conns.init();
    await conns.connectAll();
    const seen: number[] = [];
    const onRemoved = (id: number) => seen.push(id);
    conns.on('removed', onRemoved);
    conns.off('removed', onRemoved);
    await conns.remove(2);
    expect(seen).toEqual([]);
    expect(two.status.state).toBe('disconnected');
    expect(() => conns.adapter(2)).toThrow();
    await conns.disconnectAll();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ inboxId: 1 }),
      'wa disconnect failed',
    );
  });
});
