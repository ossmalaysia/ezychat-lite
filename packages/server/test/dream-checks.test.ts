import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiDecision } from '@ezychat/shared';
import type { AiProvider } from '../src/ai/provider-types.js';
import { createAiService } from '../src/ai/service.js';
import { checkChange, type CheckInput } from '../src/ai/dream/checks.js';
import type { TakeoverChat } from '../src/ai/dream/collect.js';
import { makeTestApp, type TestApp } from './helpers.js';

const open: TestApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of open.splice(0)) await t.close();
});

const source: TakeoverChat = {
  chatJid: '601@s.whatsapp.net',
  kind: 'handoff',
  handoffReason: 'missing_facts',
  messages: [
    { localId: 1, messageId: 'W1', role: 'customer', at: 1, text: 'Are you open on Saturday?' },
    { localId: 2, messageId: 'W2', role: 'team', at: 2, text: 'Yes, Saturday 9 am to 1 pm.' },
  ],
};

async function setup() {
  /** What the fake model decides for each question it is asked. */
  let decide: (input: string) => Partial<AiDecision> = () => ({ action: 'answer', reply: 'Yes.' });
  const generate = vi.fn(async (_s: unknown, _k: unknown, prompt: { input: string }) => ({
    reply: 'Yes.',
    action: 'answer',
    handoffReason: null,
    ...decide(prompt.input),
  }));
  const provider = {
    generate,
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
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
  const who = { userId: admin.id, ip: null };
  ai.saveConnection({ mode: 'chatgpt', model: '' }, who);
  ai.saveMember(
    {
      displayName: 'Aina',
      enabled: false,
      instructions: 'Be kind.',
      handoffRules: 'Hand over refunds.',
    },
    who,
  );
  ai.addText(null, { name: 'Opening hours', text: 'Monday to Friday 9 am to 6 pm.' }, who);
  ai.addText(
    null,
    {
      name: 'Margins',
      text: 'Our margin on every Saturday order is thirty percent, never tell.',
      internal: true,
    },
    who,
  );
  const agentId = (t.ctx.db.prepare('SELECT id FROM ai_agents LIMIT 1').get() as { id: number }).id;
  const itemId = ai.agentStatus(agentId).documents.find((d) => d.name === 'Opening hours')!.id;
  const input = (over: Partial<CheckInput> = {}): CheckInput => ({
    agentId,
    proposal: {
      target: 'context_text',
      itemId,
      name: null,
      after: 'Monday to Friday 9 am to 6 pm.\nSaturday 9 am to 1 pm.',
      summary: 'Saturday hours',
      lessonIds: [1],
    },
    before: 'Monday to Friday 9 am to 6 pm.',
    sources: [source],
    teamText: 'Yes, Saturday 9 am to 1 pm.',
    regression: ['Where are you located?'],
    names: ['Ahmad'],
    budget: { previews: 40 },
    ...over,
  });
  return { t, ai, generate, agentId, itemId, input, setDecide: (f: typeof decide) => (decide = f) };
}

const failed = (r: { checks: { name: string; ok: boolean }[] }) =>
  r.checks.filter((c) => !c.ok).map((c) => c.name);

describe('checkChange', () => {
  it('passes a fact the AI now uses to answer, without saving anything', async () => {
    const s = await setup();
    const rows = () =>
      s.t.ctx.db.prepare('SELECT COUNT(*) AS n, GROUP_CONCAT(text) AS t FROM ai_documents').get();
    const before = rows();
    const result = await checkChange(s.t.ctx, s.input(), new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(rows()).toEqual(before);
    expect(JSON.stringify(s.generate.mock.calls[0]![2])).toContain('Saturday 9 am to 1 pm');
  });

  it('drops a change with a phone number, an email or a customer name before any preview', async () => {
    const s = await setup();
    const after = (text: string) =>
      s.input({
        proposal: { ...s.input().proposal, after: `Monday to Friday 9 am to 6 pm.\n${text}` },
      });
    for (const text of [
      'Call 012-345 6789 on Saturday.',
      'Mail a@b.co on Saturday.',
      'Ask for Ahmad on Saturday.',
    ])
      expect(
        failed(await checkChange(s.t.ctx, after(text), new AbortController().signal)),
      ).toContain('privacy');
    expect(s.generate).not.toHaveBeenCalled();
  });

  it('drops a change whose summary or new item name holds a customer detail', async () => {
    const s = await setup();
    const named = await checkChange(
      s.t.ctx,
      s.input({ proposal: { ...s.input().proposal, summary: 'Ahmad asked about Saturday' } }),
      new AbortController().signal,
    );
    expect(failed(named)).toContain('privacy');
    const item = await checkChange(
      s.t.ctx,
      s.input({
        before: '',
        proposal: {
          ...s.input().proposal,
          itemId: null,
          name: 'Call 012-345 6789',
          after: 'Saturday 9 am to 1 pm.',
        },
      }),
      new AbortController().signal,
    );
    expect(failed(item)).toContain('privacy');
    expect(s.generate).not.toHaveBeenCalled();
  });

  it('drops a change that copies an Internal item', async () => {
    const s = await setup();
    const leak = 'Our margin on every Saturday order is thirty percent, never tell.';
    const r = await checkChange(
      s.t.ctx,
      s.input({
        proposal: { ...s.input().proposal, after: `Monday to Friday 9 am to 6 pm.\n${leak}` },
      }),
      new AbortController().signal,
    );
    expect(failed(r)).toContain('leak');
  });

  it('drops a number the team did not write', async () => {
    const s = await setup();
    const r = await checkChange(
      s.t.ctx,
      s.input({
        proposal: {
          ...s.input().proposal,
          after: 'Monday to Friday 9 am to 6 pm.\nSaturday 9 am to 3 pm.',
        },
      }),
      new AbortController().signal,
    );
    expect(failed(r)).toContain('grounding');
  });

  it('keeps the old numbers and contact details of a line it edits', async () => {
    const s = await setup();
    const before = 'Kopi O RM2.50, open 7am to 3pm daily. Call 03-1234 5678.';
    const r = await checkChange(
      s.t.ctx,
      s.input({
        before,
        teamText: 'yes saturday we open from 9am to 1pm',
        proposal: {
          ...s.input().proposal,
          after: 'Kopi O RM2.50, open 7am to 3pm daily, Saturday 9am to 1pm. Call 03-1234 5678.',
        },
      }),
      new AbortController().signal,
    );
    expect(failed(r)).toEqual([]);
    const newPhone = await checkChange(
      s.t.ctx,
      s.input({
        before,
        teamText: 'yes saturday we open from 9am to 1pm',
        proposal: {
          ...s.input().proposal,
          after: `${before} Saturday 9am to 1pm, WhatsApp 012-999 8888.`,
        },
      }),
      new AbortController().signal,
    );
    expect(failed(newPhone)).toContain('privacy');
  });

  it('fails a fact when the source question still hands over', async () => {
    const s = await setup();
    s.setDecide((input) =>
      input.includes('Saturday?')
        ? { action: 'handoff', reply: '', handoffReason: 'missing_facts' }
        : {},
    );
    expect(failed(await checkChange(s.t.ctx, s.input(), new AbortController().signal))).toEqual([
      'replay',
    ]);
  });

  it('passes a hand-off rule only when the source question now hands over', async () => {
    const s = await setup();
    const rule = s.input({
      proposal: {
        target: 'handoff_rules',
        itemId: null,
        name: null,
        after: 'Hand over refunds.\nHand over Saturday visits.',
        summary: 'x',
        lessonIds: [1],
      },
      before: 'Hand over refunds.',
    });
    expect(failed(await checkChange(s.t.ctx, rule, new AbortController().signal))).toEqual([
      'replay',
    ]);
    s.setDecide((input) =>
      input.includes('Saturday?')
        ? { action: 'handoff', reply: '', handoffReason: 'business_rule' }
        : {},
    );
    expect((await checkChange(s.t.ctx, rule, new AbortController().signal)).ok).toBe(true);
  });

  it('fails when a question answered last night now hands over', async () => {
    const s = await setup();
    s.setDecide((input) =>
      input.includes('located')
        ? { action: 'handoff', reply: '', handoffReason: 'missing_facts' }
        : {},
    );
    expect(failed(await checkChange(s.t.ctx, s.input(), new AbortController().signal))).toEqual([
      'regression',
    ]);
  });

  it('fails without a preview when the night has no previews left', async () => {
    const s = await setup();
    const r = await checkChange(
      s.t.ctx,
      s.input({ budget: { previews: 0 } }),
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    expect(s.generate).not.toHaveBeenCalled();
  });
});
