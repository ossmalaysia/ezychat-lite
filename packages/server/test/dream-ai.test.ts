import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiProvider } from '../src/ai/provider-types.js';
import { createAiService } from '../src/ai/service.js';
import type { TakeoverChat } from '../src/ai/dream/collect.js';
import { makeTestApp, type TestApp } from './helpers.js';

const open: TestApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of open.splice(0)) await t.close();
});

const chat: TakeoverChat = {
  chatJid: '601@s.whatsapp.net',
  kind: 'handoff',
  handoffReason: 'missing_facts',
  messages: [
    { localId: 1, messageId: 'WA-1', role: 'customer', at: 1, text: 'Open on Saturday?' },
    { localId: 2, messageId: 'WA-2', role: 'team', at: 2, text: 'Yes, 9 am to 1 pm.' },
  ],
};

async function setup(connected = true) {
  const outputs: unknown[] = [];
  const draft = vi.fn(async (..._args: unknown[]) => ({
    output: outputs.shift(),
    model: 'gpt-test',
  }));
  const provider = {
    generate: vi.fn(),
    draft,
    connection: () => ({
      state: connected ? 'connected' : 'signed_out',
      loginUrl: null,
      error: null,
    }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  } as unknown as AiProvider;
  const t = await makeTestApp({
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
      ctx.services.ai = createAiService(ctx, { provider });
    },
  });
  open.push(t);
  const admin = t.ctx.services.auth!.createUser({
    username: 'admin',
    displayName: 'Admin',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  const ai = t.ctx.services.ai!;
  ai.saveConnection({ mode: 'chatgpt', model: '' }, { userId: admin.id, ip: null });
  ai.saveMember(
    {
      displayName: 'Aina',
      enabled: false,
      instructions: 'Be kind.',
      handoffRules: 'Hand over refunds.',
    },
    { userId: admin.id, ip: null },
  );
  const agentId = (t.ctx.db.prepare('SELECT id FROM ai_agents LIMIT 1').get() as { id: number }).id;
  return { ai, draft, outputs, agentId };
}

describe('AiService.dreamLessons / dreamMerge', () => {
  it('asks the model once per chat and keeps only grounded lessons', async () => {
    const s = await setup();
    s.outputs.push({
      lessons: [
        { kind: 'fact', text: 'Open on Saturday 9 am to 1 pm.', teamMessageIds: [2] },
        { kind: 'fact', text: 'Open on Sunday too.', teamMessageIds: [1] },
      ],
    });
    const lessons = await s.ai.dreamLessons(s.agentId, chat, new AbortController().signal);
    expect(lessons.map((l) => l.text)).toEqual(['Open on Saturday 9 am to 1 pm.']);
    expect(s.draft).toHaveBeenCalledTimes(1);
    const prompt = s.draft.mock.calls[0]![2] as { instructions: string; input: string };
    expect(prompt.input).not.toContain('WA-');
  });

  it('merges lessons into at most 5 changes from the agent setup, without Internal items', async () => {
    const s = await setup();
    s.ai.addText(s.agentId, { name: 'Secret', text: 'Cost RM 3.', internal: true } as never, {
      userId: null,
      ip: null,
    });
    s.outputs.push({
      changes: [
        {
          target: 'handoff_rules',
          itemId: null,
          name: null,
          after: 'Hand over refunds and complaints.',
          summary: 'Complaints to team',
          lessonIds: [1],
        },
      ],
    });
    const out = await s.ai.dreamMerge(
      s.agentId,
      [{ kind: 'handoff', text: 'Complaints go to the team.', teamMessageIds: [2] }],
      new AbortController().signal,
    );
    expect(out.proposals).toHaveLength(1);
    expect(out.setup.handoffRules).toBe('Hand over refunds.');
    const prompt = s.draft.mock.calls[0]![2] as { input: string };
    expect(prompt.input).not.toContain('Cost RM 3.');
  });

  it('refuses an unknown agent before any model call', async () => {
    const s = await setup();
    await expect(
      s.ai.dreamLessons(s.agentId + 1, chat, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'agent_not_found' });
    expect(s.draft).not.toHaveBeenCalled();
  });

  it('refuses while the AI connection is not ready', async () => {
    const s = await setup(false);
    await expect(
      s.ai.dreamLessons(s.agentId, chat, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'ai_unavailable',
    });
    expect(s.draft).not.toHaveBeenCalled();
  });
});
