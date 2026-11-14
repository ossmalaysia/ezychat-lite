import { vi } from 'vitest';
import type { AiProvider } from '../src/ai/provider-types.js';
import { createAiService } from '../src/ai/service.js';
import { getChats } from '../src/wa-bridge/index.js';
import { makeTestApp, type TestApp } from './helpers.js';

export const MIN = 60_000;
export const DAY = 24 * 60 * MIN;

/** A fake model for dream mode: `draft` answers the lesson and merge calls, `generate` the previews. */
export function fakeDreamProvider() {
  const answers = { lessons: [] as unknown[], merges: [] as unknown[] };
  const decide = { fn: (_input: string): Record<string, unknown> => ({}) };
  const state = { connected: true };
  const draft = vi.fn(async (_s: unknown, _k: unknown, prompt: { instructions: string }) => ({
    output: prompt.instructions.startsWith('You read one WhatsApp chat')
      ? (answers.lessons.shift() ?? { lessons: [] })
      : (answers.merges.shift() ?? { changes: [] }),
    model: 'gpt-test',
  }));
  const generate = vi.fn(
    async (_s: unknown, _k: unknown, prompt: { instructions: string; input: string }) => ({
      reply: 'Yes.',
      action: 'answer',
      handoffReason: null,
      // The rules (instructions) and the question (input): a fake decision may look at either.
      ...decide.fn(`${prompt.instructions}
${prompt.input}`),
    }),
  );
  const provider = {
    generate,
    draft,
    connection: () => ({
      state: state.connected ? 'connected' : 'signed_out',
      loginUrl: null,
      error: null,
    }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  } as unknown as AiProvider;
  return { provider, answers, decide, state, draft, generate };
}

/** A test app with one AI agent (on or off), an admin and helpers that seed chats the way WhatsApp would. */
export async function dreamApp(opts: { provider?: AiProvider; agentOn?: boolean } = {}) {
  const t: TestApp = await makeTestApp(
    opts.provider
      ? {
          beforeBuild: async (ctx) => {
            await ctx.services.ai!.shutdown();
            ctx.services.ai = createAiService(ctx, { provider: opts.provider });
          },
        }
      : {},
  );
  const admin = t.ctx.services.auth!.createUser({
    username: 'jazz',
    displayName: 'Jazz',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  const ai = t.ctx.services.ai!;
  const who = { userId: admin.id, ip: null };
  if (opts.provider) ai.saveConnection({ mode: 'chatgpt', model: '' }, who);
  ai.saveMember(
    {
      displayName: 'Aina',
      enabled: false,
      instructions: 'Be kind.',
      handoffRules: 'Hand over refunds.',
    },
    who,
  );
  const agent = t.ctx.db.prepare('SELECT id, user_id FROM ai_agents LIMIT 1').get() as {
    id: number;
    user_id: number;
  };
  const setAgentOn = (on: boolean) =>
    t.ctx.db
      .prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
      .run(on ? null : 1, agent.user_id);
  if (opts.agentOn) setAgentOn(true);
  let n = 0;
  const chat = (jid: string, name: string, type: 'dm' | 'group' = 'dm') =>
    getChats(t.ctx).upsertFromWa({ jid, type, name }, 1);
  const msg = (
    jid: string,
    at: number,
    who: 'customer' | 'ai' | 'team' | 'phone',
    body: string | null,
    extra: { forwarded?: boolean; deleted?: boolean; type?: string } = {},
  ) => {
    const id = `M${++n}`;
    t.ctx.db
      .prepare(
        `INSERT INTO messages (id, chat_jid, from_me, sent_by_user_id, type, body, status, timestamp, created_at,
           media_status, forwarding_score, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?, 'none', ?, ?)`,
      )
      .run(
        id,
        jid,
        who === 'customer' ? 0 : 1,
        who === 'ai' ? agent.user_id : who === 'team' ? admin.id : null,
        extra.type ?? 'text',
        body,
        at,
        at,
        extra.forwarded ? 1 : null,
        extra.deleted ? at : null,
      );
    return id;
  };
  const handoff = (jid: string, at: number) =>
    t.ctx.db
      .prepare(
        "INSERT INTO audit_log (user_id, action, ip, meta, at) VALUES (?, 'ai.handoff', NULL, ?, ?)",
      )
      .run(
        agent.user_id,
        JSON.stringify({
          chatJid: jid,
          assignedTo: null,
          reason: 'missing_facts',
          agentId: agent.id,
        }),
        at,
      );
  const replyOverAi = (jid: string, at: number) =>
    t.ctx.db
      .prepare(
        "INSERT INTO chat_events (chat_jid, type, actor_id, payload, at) VALUES (?, 'assigned', ?, ?, ?)",
      )
      .run(
        jid,
        admin.id,
        JSON.stringify({ assignedTo: admin.id, previous: agent.user_id, reason: 'reply' }),
        at,
      );
  return { t, ai, admin, agent, setAgentOn, chat, msg, handoff, replyOverAi };
}
