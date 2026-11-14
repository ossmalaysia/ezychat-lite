import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../../db/index.js';
import { DREAM_WAITING_TTL_MS } from '@ezychat/shared';
import { DreamRepo, type NewChange } from './repo.js';

let db: DB;
let repo: DreamRepo;
const DAY = 24 * 60 * 60_000;

function addAgent(name: string): number {
  const user = db
    .prepare(
      "INSERT INTO users (username, display_name, password_hash, role, kind, created_at) VALUES (?, ?, '', 'agent', 'ai', 1)",
    )
    .run(`ai-${name}`, name);
  return Number(
    db
      .prepare(
        'INSERT INTO ai_agents (user_id, inbox_id, created_at, updated_at) VALUES (?, 1, 1, 1)',
      )
      .run(user.lastInsertRowid).lastInsertRowid,
  );
}

const change = (over: Partial<NewChange> = {}): NewChange => ({
  target: 'context_text',
  itemId: null,
  itemName: 'Opening hours',
  before: '',
  after: 'Saturday: 9 am to 1 pm.',
  summary: 'Saturday hours',
  sourceMessageIds: [1, 2],
  checks: [{ name: 'replay', ok: true }],
  status: 'waiting',
  auto: false,
  versionId: null,
  createdAt: 1,
  ...over,
});

beforeEach(() => {
  db = openDb(':memory:');
  repo = new DreamRepo(db);
});
afterEach(() => db.close());

describe('DreamRepo', () => {
  it('starts switched off at 02:00 without Apply by itself', () => {
    const agent = addAgent('Sales');
    expect(repo.settings(agent)).toEqual({ enabled: false, runTime: '02:00', autoApply: false });
    expect(repo.enabledAgents()).toEqual([]);
  });

  it('saves settings and reports before and after', () => {
    const agent = addAgent('Sales');
    const saved = repo.saveSettings(agent, { enabled: true, runTime: '03:30' }, 5);
    expect(saved.before).toEqual({ enabled: false, runTime: '02:00', autoApply: false });
    expect(saved.after).toEqual({ enabled: true, runTime: '03:30', autoApply: false });
    expect(repo.enabledAgents()).toEqual([{ agentId: agent, runTime: '03:30', autoApply: false }]);
  });

  it('claims a nightly slot only once', () => {
    const agent = addAgent('Sales');
    expect(repo.claimRun(agent, 1000, 1)).toBeTypeOf('number');
    expect(repo.claimRun(agent, 1000, 2)).toBeNull();
  });

  it('pages the history newest first, 30 runs a page', () => {
    const agent = addAgent('Sales');
    for (let slot = 1; slot <= 31; slot++) {
      const run = repo.claimRun(agent, slot, slot)!;
      repo.finishRun(
        run,
        { status: 'done', reason: null, chatsRead: 2, takeovers: 1, saved: 1, dropped: 0 },
        slot,
      );
      repo.addChange(run, agent, change());
    }
    const first = repo.history(agent, null);
    expect(first.runs).toHaveLength(30);
    expect(first.runs[0]!.slot).toBe(31);
    expect(first.runs[0]!.changes).toHaveLength(1);
    expect(first.nextBefore).toBe(first.runs[29]!.id);
    const second = repo.history(agent, first.nextBefore);
    expect(second.runs.map((r) => r.slot)).toEqual([1]);
    expect(second.nextBefore).toBeNull();
    expect(repo.lastFinishedAt(agent)).toBe(31);
  });

  it('expires a waiting change after 14 days', () => {
    const agent = addAgent('Sales');
    const run = repo.claimRun(agent, 1, 1)!;
    const now = 100 * DAY;
    const old = repo.addChange(run, agent, change({ createdAt: now - DREAM_WAITING_TTL_MS - DAY }));
    const recent = repo.addChange(run, agent, change({ createdAt: now - 13 * DAY }));
    repo.expireWaiting(now);
    expect(repo.change(old)!.status).toBe('expired');
    expect(repo.change(recent)!.status).toBe('waiting');
  });

  it('records who decided a change and its setup version', () => {
    const agent = addAgent('Sales');
    const run = repo.claimRun(agent, 1, 1)!;
    const id = repo.addChange(run, agent, change());
    repo.setStatus(id, 'applied', { versionId: 7, decidedBy: null, now: 9 });
    expect(repo.change(id)).toMatchObject({
      status: 'applied',
      versionId: 7,
      decidedBy: null,
      decidedAt: 9,
    });
  });

  it('removes settings, runs and changes with the agent', () => {
    const agent = addAgent('Sales');
    repo.saveSettings(agent, { enabled: true }, 1);
    const run = repo.claimRun(agent, 1, 1)!;
    repo.addChange(run, agent, change());
    db.prepare('DELETE FROM ai_agents WHERE id = ?').run(agent);
    for (const table of ['ai_dream_settings', 'ai_dream_runs', 'ai_dream_changes'])
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  });
});
