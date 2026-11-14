import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { authHeaders } from './auth-helpers.js';
import { createDreamService } from '../src/ai/dream/service.js';
import { DreamRepo } from '../src/ai/dream/repo.js';
import { listSetupVersions } from '../src/ai/setup-versions.js';
import type { TestApp } from './helpers.js';
import { DAY, MIN, dreamApp, fakeDreamProvider } from './dream-helpers.js';

const open: TestApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (open.length) await open.pop()!.close();
});

/** 02:00 on 10 Nov 2026 in Asia/Kuala_Lumpur (UTC+8), the default business time zone. */
const SLOT = Date.UTC(2026, 10, 9, 18, 0);
const CHAT = '60111111111@s.whatsapp.net';
const SATURDAY = 'Are you open on Saturday?';

async function setup(opts: { autoApply?: boolean; settingsAt?: number } = {}) {
  const fake = fakeDreamProvider();
  const s = await dreamApp({ provider: fake.provider, agentOn: true });
  open.push(s.t);
  const repo = new DreamRepo(s.t.ctx.db);
  repo.saveSettings(
    s.agent.id,
    { enabled: true, autoApply: opts.autoApply ?? false },
    opts.settingsAt ?? SLOT - DAY,
  );
  // One take-over in the night's window: the team gave the Saturday hours.
  s.chat(CHAT, 'Ahmad Lee');
  s.msg(CHAT, SLOT - 5 * 60 * MIN, 'customer', SATURDAY);
  s.handoff(CHAT, SLOT - 5 * 60 * MIN + 1);
  s.msg(CHAT, SLOT - 4 * 60 * MIN, 'team', 'Yes, Saturday 9 am to 1 pm.');
  let clock = SLOT + 5 * MIN;
  const service = createDreamService(s.t.ctx, { now: () => clock, timers: false });
  const runs = () =>
    s.t.ctx.db.prepare('SELECT status, reason, takeovers, saved, dropped FROM ai_dream_runs').all();
  const changes = () =>
    s.t.ctx.db
      .prepare('SELECT target, status, auto, version_id FROM ai_dream_changes ORDER BY id')
      .all();
  const lesson = () =>
    fake.answers.lessons.push({
      lessons: [{ kind: 'fact', text: 'Open on Saturday 9 am to 1 pm.', teamMessageIds: [2] }],
    });
  return {
    ...s,
    fake,
    repo,
    service,
    runs,
    changes,
    lesson,
    setClock: (at: number) => (clock = at),
  };
}

const fact = {
  target: 'context_text',
  itemId: null,
  name: 'Opening hours',
  after: 'Saturday 9 am to 1 pm.',
  summary: 'Saturday hours',
  lessonIds: [1],
};
const rule = {
  target: 'handoff_rules',
  itemId: null,
  name: null,
  after: 'Hand over refunds.\nHand over Saturday visits.',
  summary: 'Saturday visits',
  lessonIds: [1],
};

describe('dream mode nightly run', () => {
  it('runs a night once, at 02:00 business time', async () => {
    const s = await setup();
    s.lesson();
    s.fake.answers.merges.push({ changes: [fact] });
    await s.service.tick();
    await s.service.tick();
    expect(s.runs()).toEqual([
      { status: 'done', reason: null, takeovers: 1, saved: 1, dropped: 0 },
    ]);
    expect(s.changes()).toEqual([
      { target: 'context_text', status: 'waiting', auto: 0, version_id: null },
    ]);
  });

  it('records a night missed by more than 60 minutes and never runs it later', async () => {
    const s = await setup();
    s.setClock(SLOT + 61 * MIN);
    await s.service.tick();
    s.setClock(SLOT + 2 * 60 * MIN);
    await s.service.tick();
    expect(s.runs()).toEqual([
      { status: 'missed', reason: null, takeovers: 0, saved: 0, dropped: 0 },
    ]);
    expect(s.fake.draft).not.toHaveBeenCalled();
  });

  it('does not run a night whose time was set after it', async () => {
    const s = await setup({ settingsAt: SLOT + MIN });
    await s.service.tick();
    expect(s.runs()).toEqual([]);
  });

  it('skips with ai_unavailable while the AI is not connected', async () => {
    const s = await setup();
    s.fake.state.connected = false;
    await s.service.tick();
    expect(s.runs()).toEqual([
      { status: 'skipped', reason: 'ai_unavailable', takeovers: 0, saved: 0, dropped: 0 },
    ]);
  });

  it('skips and saves nothing when the agent is switched off mid-run', async () => {
    const s = await setup();
    s.lesson();
    s.fake.answers.merges.push({ changes: [fact] });
    s.fake.decide.fn = () => {
      s.setAgentOn(false);
      return {};
    };
    await s.service.tick();
    expect(s.changes()).toEqual([]);
    expect(s.runs()).toMatchObject([{ status: 'skipped', reason: 'agent_off' }]);
  });

  it('applies a fact by itself but leaves a hand-off rule waiting', async () => {
    const s = await setup({ autoApply: true });
    s.lesson();
    s.fake.answers.merges.push({ changes: [fact, rule] });
    // The proposed rule makes the Saturday question hand over; the fact lets the AI answer it.
    s.fake.decide.fn = (input) =>
      input.includes('Saturday visits') ? { action: 'handoff', reply: '' } : {};
    await s.service.tick();
    expect(s.changes()).toEqual([
      { target: 'context_text', status: 'applied', auto: 1, version_id: expect.any(Number) },
      { target: 'handoff_rules', status: 'waiting', auto: 0, version_id: null },
    ]);
    const item = s.ai.agentStatus(s.agent.id).documents.find((d) => d.name === 'Opening hours')!;
    expect(listSetupVersions(s.t.ctx.db, s.agent.id, 'context_text', item.id, 1)[0]).toMatchObject({
      via: 'dream',
    });
    const audit = s.t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'dream.change.applied'")
      .get() as { meta: string };
    expect(JSON.parse(audit.meta)).toMatchObject({ auto: true });
  });

  it('drops a change that fails a check and counts it', async () => {
    const s = await setup();
    s.lesson();
    s.fake.answers.merges.push({
      changes: [{ ...fact, after: 'Saturday 9 am to 1 pm, call 012-345 6789.' }],
    });
    await s.service.tick();
    expect(s.changes()).toEqual([]);
    expect(s.runs()).toEqual([
      { status: 'done', reason: null, takeovers: 1, saved: 0, dropped: 1 },
    ]);
  });

  it('logs counts only, never the team text, the lessons or the change', async () => {
    const s = await setup();
    const lines: string[] = [];
    const capture = pino({ level: 'debug' }, { write: (line: string) => lines.push(line) });
    const child = s.t.ctx.log.child.bind(s.t.ctx.log);
    vi.spyOn(s.t.ctx.log, 'child').mockImplementation(((b: Record<string, unknown>) =>
      b.mod === 'dream' || b.mod === 'ai' ? capture.child(b) : child(b)) as never);
    const service = createDreamService(s.t.ctx, { now: () => SLOT + 5 * MIN, timers: false });
    s.lesson();
    s.fake.answers.merges.push({ changes: [fact] });
    await service.tick();
    expect(lines.some((l) => l.includes('dream_run'))).toBe(true);
    expect(lines.join('\n')).not.toMatch(/Saturday|9 am/);
  });

  it('runs an agent dream now through the dev route, for admins only', async () => {
    const s = await setup();
    const cookie = (id: number) =>
      `sid=${s.t.ctx.services.auth!.createSession(id, { ip: '127.0.0.1', userAgent: 't' })}`;
    const agentUser = s.t.ctx.services.auth!.createUser({
      username: 'dan',
      displayName: 'Dan',
      role: 'agent',
      password: 'password123',
      mustChangePassword: false,
    });
    const post = (id: number) =>
      s.t.app.inject({
        method: 'POST',
        url: '/api/dev/dream-run',
        headers: authHeaders(cookie(id)),
        payload: { agentId: s.agent.id },
      });
    expect((await post(agentUser.id)).statusCode).toBe(403);
    const res = await post(s.admin.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().runId).toBeTypeOf('number');
    expect(s.runs()).toHaveLength(1);
  });

  it('runs now for the dev route and keeps going when one chat fails', async () => {
    const s = await setup();
    s.fake.draft.mockRejectedValueOnce(new Error('model down'));
    const runId = await s.service.runNow(s.agent.id);
    expect(runId).toBeTypeOf('number');
    expect(s.runs()).toMatchObject([{ status: 'done', takeovers: 1, saved: 0 }]);
  });
});
