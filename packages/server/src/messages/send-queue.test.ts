import { describe, it, expect } from 'vitest';
import type { SendResult } from '@wa-team-inbox/wa';
import { SendQueue, UNAVAILABLE_RETRY_MS, type SendJob } from './send-queue.js';

const flush = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

function job(localId: string, chatJid: string, createdAt: number): SendJob {
  return { localId, chatJid, createdAt, kind: 'text', text: localId };
}

function makeQueue(opts: { connected?: boolean; now?: () => number; sleep?: (ms: number) => Promise<void>; failIds?: string[] } = {}) {
  let connected = opts.connected ?? true;
  const sent: Array<{ id: string; at: number }> = [];
  const ok: string[] = [];
  const failed: Array<{ id: string; msg: string }> = [];
  const presence: string[] = [];
  const now = opts.now ?? (() => Date.now());
  let n = 0;
  const q = new SendQueue({
    send: async (j): Promise<SendResult> => {
      if (opts.failIds?.includes(j.localId)) throw new Error('boom');
      sent.push({ id: j.localId, at: now() });
      return { id: `WA-${++n}`, timestamp: now() };
    },
    onSent: (j) => ok.push(j.localId),
    onFailed: (j, err) => failed.push({ id: j.localId, msg: err.message }),
    isConnected: () => connected,
    presence: async (jid) => {
      presence.push(jid);
    },
    now,
    sleep: opts.sleep,
    spacingMs: 1000,
    maxAgeMs: 600_000,
  });
  return { q, sent, ok, failed, presence, setConnected: (c: boolean) => (connected = c) };
}

describe('SendQueue', () => {
  it('sends FIFO per chat with composing presence before each send', async () => {
    let clock = 1_000_000;
    const { q, sent, ok, presence } = makeQueue({
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    q.enqueue(job('a1', 'A', clock));
    q.enqueue(job('a2', 'A', clock));
    q.enqueue(job('a3', 'A', clock));
    await flush();
    expect(sent.map((s) => s.id)).toEqual(['a1', 'a2', 'a3']);
    expect(ok).toEqual(['a1', 'a2', 'a3']);
    expect(presence.length).toBe(3);
    q.stop();
  });

  it('respects >= spacingMs between sends in the same chat (fake clock)', async () => {
    let clock = 5_000_000;
    const sleeps: number[] = [];
    const { q, sent } = makeQueue({
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    q.enqueue(job('a1', 'A', clock));
    q.enqueue(job('a2', 'A', clock));
    q.enqueue(job('b1', 'B', clock));
    await flush();
    const a = sent.filter((s) => s.id.startsWith('a'));
    expect(a.length).toBe(2);
    expect(a[1]!.at - a[0]!.at).toBeGreaterThanOrEqual(1000);
    expect(sent.some((s) => s.id === 'b1')).toBe(true);
    q.stop();
  });

  it('waits while disconnected, then flushes on onConnected', async () => {
    const { q, sent, ok, setConnected } = makeQueue({ connected: false, sleep: () => new Promise(() => undefined) });
    q.enqueue(job('x1', 'X', Date.now()));
    await flush();
    expect(sent).toEqual([]);
    setConnected(true);
    q.onConnected();
    await flush();
    expect(sent.map((s) => s.id)).toEqual(['x1']);
    expect(ok).toEqual(['x1']);
    q.stop();
  });

  it('fails jobs older than maxAge with "expired" and never sends them', async () => {
    const clock = 10_000_000;
    const { q, sent, failed } = makeQueue({ now: () => clock });
    q.enqueue(job('old', 'A', clock - 11 * 60_000));
    await flush();
    expect(sent).toEqual([]);
    expect(failed).toEqual([{ id: 'old', msg: 'expired' }]);
    q.stop();
  });

  it('a job waiting for a connection expires instead of sending late', async () => {
    let clock = 20_000_000;
    const { q, sent, failed, setConnected } = makeQueue({
      connected: false,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    q.enqueue(job('late', 'A', clock));
    await flush(50);
    expect(failed).toEqual([{ id: 'late', msg: 'expired' }]);
    setConnected(true);
    q.onConnected();
    await flush();
    expect(sent).toEqual([]);
    q.stop();
  });

  it('send failure → onFailed, queue continues with next job', async () => {
    let clock = 1;
    const { q, sent, failed } = makeQueue({
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      failIds: ['f1'],
    });
    q.enqueue(job('f1', 'A', clock));
    q.enqueue(job('f2', 'A', clock));
    await flush();
    expect(failed).toEqual([{ id: 'f1', msg: 'boom' }]);
    expect(sent.map((s) => s.id)).toEqual(['f2']);
    q.stop();
  });

  it('a wa_unavailable error while status still reads open keeps the job pending and re-sends it', async () => {
    let clock = 1;
    let attempts = 0;
    const sent: string[] = [];
    const failed: string[] = [];
    const sleeps: number[] = [];
    const q = new SendQueue({
      send: async (j): Promise<SendResult> => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error('Connection Closed'), { code: 'wa_unavailable' });
        sent.push(j.localId);
        return { id: 'WA-1', timestamp: clock };
      },
      onSent: () => undefined,
      onFailed: (j) => failed.push(j.localId),
      isConnected: () => true, // close event has not arrived yet
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      spacingMs: 1000,
      maxAgeMs: 600_000,
    });
    q.enqueue(job('u1', 'A', clock));
    await flush();
    expect(failed).toEqual([]);
    expect(sent).toEqual(['u1']);
    expect(sleeps).toContain(UNAVAILABLE_RETRY_MS);
    q.stop();
  });

  it('restore() enqueues persisted jobs', async () => {
    const { q, sent } = makeQueue({ sleep: async () => undefined });
    q.restore([job('r1', 'A', Date.now()), job('r2', 'B', Date.now())]);
    await flush();
    expect(sent.map((s) => s.id).sort()).toEqual(['r1', 'r2']);
    q.stop();
  });
});
