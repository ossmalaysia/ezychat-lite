import { afterEach, describe, expect, it, vi } from 'vitest';
import { DreamRepo, type NewChange } from '../src/ai/dream/repo.js';
import type { TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';
import { dreamApp, fakeDreamProvider } from './dream-helpers.js';

const open: TestApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (open.length) await open.pop()!.close();
});

const CHAT = '60111111111@s.whatsapp.net';

async function setup() {
  const fake = fakeDreamProvider();
  const s = await dreamApp({ provider: fake.provider });
  open.push(s.t);
  const auth = s.t.ctx.services.auth!;
  const cookie = (id: number) =>
    `sid=${auth.createSession(id, { ip: '127.0.0.1', userAgent: 't' })}`;
  const admin = cookie(s.admin.id);
  const agentUser = auth.createUser({
    username: 'dan',
    displayName: 'Dan',
    role: 'agent',
    password: 'password123',
    mustChangePassword: false,
  });
  s.ai.addText(
    s.agent.id,
    { name: 'Opening hours', text: 'Closed on weekends.' },
    { userId: s.admin.id, ip: null },
  );
  const itemId = s.ai.agentStatus(s.agent.id).documents.find((d) => d.name === 'Opening hours')!.id;
  s.chat(CHAT, 'Ahmad');
  const question = s.msg(CHAT, 1, 'customer', 'Open on Saturday?');
  const answer = s.msg(CHAT, 2, 'team', 'Yes, 9 am to 1 pm.');
  const repo = new DreamRepo(s.t.ctx.db);
  const run = repo.claimRun(s.agent.id, 100, 100)!;
  repo.finishRun(
    run,
    { status: 'done', reason: null, chatsRead: 1, takeovers: 1, saved: 1, dropped: 0 },
    101,
  );
  const change = (over: Partial<NewChange> = {}) =>
    repo.addChange(run, s.agent.id, {
      target: 'context_text',
      itemId,
      itemName: 'Opening hours',
      before: 'Closed on weekends.',
      after: 'Saturday 9 am to 1 pm.',
      summary: 'Saturday hours',
      sourceMessageIds: [question, answer],
      checks: [{ name: 'replay', ok: true }],
      status: 'waiting',
      auto: false,
      versionId: null,
      createdAt: 102,
      ...over,
    });
  const call = (method: 'GET' | 'PUT' | 'POST', url: string, as = admin, payload?: object) =>
    s.t.app.inject({
      method,
      url: `/api/ai/agents/${s.agent.id}/dream${url}`,
      headers: authHeaders(as),
      payload,
    });
  return {
    ...s,
    fake,
    repo,
    itemId,
    change,
    call,
    adminCookie: admin,
    agent: s.agent,
    agentCookie: cookie(agentUser.id),
    question,
    answer,
  };
}

describe('dream mode routes', () => {
  it('is for admins only', async () => {
    const s = await setup();
    expect((await s.call('GET', '', s.agentCookie)).statusCode).toBe(403);
  });

  it('shows the settings, the history and whether the AI is ready', async () => {
    const s = await setup();
    s.change();
    const res = await s.call('GET', '');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      settings: { enabled: false, runTime: '02:00', autoApply: false },
      aiReady: true,
      nextBefore: null,
      runs: [
        {
          status: 'done',
          takeovers: 1,
          saved: 1,
          changes: [{ status: 'waiting', summary: 'Saturday hours' }],
        },
      ],
    });
  });

  it('saves settings, checks the time and audits before and after', async () => {
    const s = await setup();
    expect((await s.call('PUT', '', s.adminCookie, { runTime: '25:00' })).statusCode).toBe(400);
    const res = await s.call('PUT', '', s.adminCookie, { enabled: true, runTime: '03:30' });
    expect(res.json()).toEqual({ enabled: true, runTime: '03:30', autoApply: false });
    const row = s.t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'dream.settings'")
      .get() as { meta: string };
    expect(JSON.parse(row.meta)).toMatchObject({
      before: { enabled: false },
      after: { enabled: true, runTime: '03:30' },
    });
  });

  it('shows a change with its texts, checks and the messages it came from', async () => {
    const s = await setup();
    const id = s.change();
    s.t.ctx.db.prepare('UPDATE messages SET deleted_at = 5 WHERE id = ?').run(s.question);
    const res = await s.call('GET', `/changes/${id}`);
    expect(res.json()).toMatchObject({
      before: 'Closed on weekends.',
      after: 'Saturday 9 am to 1 pm.',
      checks: [{ name: 'replay', ok: true }],
      sources: [{ role: 'team', name: 'Jazz', text: 'Yes, 9 am to 1 pm.' }],
    });
  });

  it('applies, then undoes a change, keeping setup versions', async () => {
    const s = await setup();
    const id = s.change();
    const applied = await s.call('POST', `/changes/${id}/apply`);
    expect(applied.json()).toMatchObject({ status: 'applied', auto: false });
    expect((s.ai.document(s.agent.id, s.itemId) as { text: string }).text).toBe(
      'Saturday 9 am to 1 pm.',
    );
    expect((await s.call('POST', `/changes/${id}/apply`)).json()).toMatchObject({
      error: { code: 'change_not_waiting' },
    });
    const undone = await s.call('POST', `/changes/${id}/undo`);
    expect(undone.json()).toMatchObject({ status: 'undone' });
    expect((s.ai.document(s.agent.id, s.itemId) as { text: string }).text).toBe(
      'Closed on weekends.',
    );
  });

  it('dismisses a waiting change', async () => {
    const s = await setup();
    const id = s.change();
    expect((await s.call('POST', `/changes/${id}/dismiss`)).json()).toMatchObject({
      status: 'dismissed',
    });
    expect(
      s.t.ctx.db
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dream.change.dismissed'")
        .get(),
    ).toEqual({ n: 1 });
  });

  it('marks a change outdated when the text changed after the suggestion', async () => {
    const s = await setup();
    const id = s.change();
    s.ai.updateText(
      s.agent.id,
      s.itemId,
      { text: 'Open every day.' },
      { userId: s.admin.id, ip: null },
    );
    const res = await s.call('POST', `/changes/${id}/apply`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'setup_changed' } });
    expect(s.repo.change(id)!.status).toBe('stale');
  });

  it('answers 404 for a change of another agent or an unknown agent', async () => {
    const s = await setup();
    const id = s.change();
    const other = await s.t.app.inject({
      method: 'GET',
      url: `/api/ai/agents/${s.agent.id + 1}/dream/changes/${id}`,
      headers: authHeaders(s.adminCookie),
    });
    expect(other.statusCode).toBe(404);
    const unknown = await s.t.app.inject({
      method: 'GET',
      url: '/api/ai/agents/999/dream',
      headers: authHeaders(s.adminCookie),
    });
    expect(unknown.statusCode).toBe(404);
  });
});
