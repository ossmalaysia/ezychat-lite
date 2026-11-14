import { afterEach, describe, expect, it } from 'vitest';
import { applySetupText, undoSetupText, DREAM_ACTOR } from '../src/ai/setup-apply.js';
import { listSetupVersions } from '../src/ai/setup-versions.js';
import { makeTestApp, type TestApp } from './helpers.js';

const open: TestApp[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

async function setup() {
  const t = await makeTestApp();
  open.push(t);
  const admin = t.ctx.services.auth!.createUser({
    username: 'admin',
    displayName: 'Aisyah',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  const ai = t.ctx.services.ai!;
  ai.saveMember(
    {
      displayName: 'Aina',
      enabled: false,
      instructions: 'Be kind.',
      handoffRules: 'Hand over refunds.',
    },
    { userId: admin.id, ip: null },
  );
  ai.addText(
    null,
    { name: 'Opening hours', text: 'Closed on weekends.' },
    { userId: admin.id, ip: null },
  );
  const agentId = (t.ctx.db.prepare('SELECT id FROM ai_agents LIMIT 1').get() as { id: number }).id;
  const itemId = ai.agentStatus(agentId).documents.find((d) => d.name === 'Opening hours')!.id;
  const text = (id: number) => (ai.document(agentId, id) as { text: string }).text;
  return { t, ai, admin, agentId, itemId, text };
}

const dream = DREAM_ACTOR('Saturday hours');

describe('applySetupText / undoSetupText', () => {
  it('edits a text item and records the version as Dream mode', async () => {
    const s = await setup();
    const out = applySetupText(
      s.t.ctx,
      {
        agentId: s.agentId,
        target: 'context_text',
        itemId: s.itemId,
        name: null,
        before: 'Closed on weekends.',
        after: 'Saturday: 9 am to 1 pm.',
      },
      dream,
    );
    expect(out.itemId).toBe(s.itemId);
    expect(s.text(s.itemId)).toBe('Saturday: 9 am to 1 pm.');
    const version = listSetupVersions(s.t.ctx.db, s.agentId, 'context_text', s.itemId, 1)[0]!;
    expect(version).toMatchObject({
      via: 'dream',
      userId: null,
      reason: 'Dream mode: Saturday hours',
    });
    expect(out.versionId).toBe(version.id);
  });

  it('refuses to apply over a text that changed since the suggestion', async () => {
    const s = await setup();
    s.ai.updateText(
      s.agentId,
      s.itemId,
      { text: 'Open every day.' },
      { userId: s.admin.id, ip: null },
    );
    expect(() =>
      applySetupText(
        s.t.ctx,
        {
          agentId: s.agentId,
          target: 'context_text',
          itemId: s.itemId,
          name: null,
          before: 'Closed on weekends.',
          after: 'x',
        },
        dream,
      ),
    ).toThrow(expect.objectContaining({ status: 409, code: 'setup_changed' }));
    expect(s.text(s.itemId)).toBe('Open every day.');
  });

  it('adds a new item and removes it again on undo', async () => {
    const s = await setup();
    const change = {
      agentId: s.agentId,
      target: 'context_text' as const,
      itemId: null,
      name: 'Delivery fees',
      before: '',
      after: 'Johor: RM 15.',
    };
    const out = applySetupText(s.t.ctx, change, dream);
    expect(s.text(out.itemId!)).toBe('Johor: RM 15.');
    undoSetupText(s.t.ctx, { ...change, itemId: out.itemId }, dream);
    expect(s.ai.agentStatus(s.agentId).documents.some((d) => d.name === 'Delivery fees')).toBe(
      false,
    );
  });

  it('refuses to undo after a later edit', async () => {
    const s = await setup();
    const change = {
      agentId: s.agentId,
      target: 'context_text' as const,
      itemId: s.itemId,
      name: null,
      before: 'Closed on weekends.',
      after: 'Sat 9-1.',
    };
    applySetupText(s.t.ctx, change, dream);
    s.ai.updateText(
      s.agentId,
      s.itemId,
      { text: 'Edited by hand.' },
      { userId: s.admin.id, ip: null },
    );
    expect(() => undoSetupText(s.t.ctx, change, dream)).toThrow(
      expect.objectContaining({ status: 409, code: 'setup_changed' }),
    );
  });

  it('applies and undoes hand-off rules and instructions', async () => {
    const s = await setup();
    const rules = {
      agentId: s.agentId,
      target: 'handoff_rules' as const,
      itemId: null,
      name: null,
      before: 'Hand over refunds.',
      after: 'Hand over refunds and complaints.',
    };
    applySetupText(s.t.ctx, rules, dream);
    expect(s.ai.agentStatus(s.agentId).settings.handoffRules).toBe(
      'Hand over refunds and complaints.',
    );
    undoSetupText(s.t.ctx, rules, dream);
    expect(s.ai.agentStatus(s.agentId).settings.handoffRules).toBe('Hand over refunds.');
    const instr = {
      agentId: s.agentId,
      target: 'instructions' as const,
      itemId: null,
      name: null,
      before: 'Be kind.',
      after: 'Be kind and short.',
    };
    applySetupText(s.t.ctx, instr, dream);
    expect(s.ai.agentStatus(s.agentId).settings.instructions).toBe('Be kind and short.');
  });
});
