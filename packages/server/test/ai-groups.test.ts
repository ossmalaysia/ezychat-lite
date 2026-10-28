// AI agents in WhatsApp groups (docs/features/ai-groups/design.md): the AI answers, in a group an
// admin switched on, only a live message that tags the business number or quotes an AI answer; it
// never takes the group; hand-overs post one line and notify; the loop guard pauses it after
// AI_GROUP_LOOP_GUARD answers in a row. Mock model only (never a real provider).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_GROUP_LOOP_GUARD,
  type AiGroupEvent,
  type Message,
  type PushSubscribeBody,
} from '@ezychat/shared';
import { FakeWaAdapter } from '@ezychat/wa';
import { agentById, listAgents } from '../src/ai/agents.js';
import {
  addressedToAi,
  groupChatStatus,
  groupText,
  loopGuard,
  memberName,
  setAgentGroups,
  setGroupChat,
} from '../src/ai/groups.js';
import {
  GROUP_GATE_RULES,
  buildGroupGatePrompt,
  openChatReaches,
  type GroupGateOutput,
} from '../src/ai/group-gate.js';
import {
  GROUP_HANDOVER_REPLY,
  GROUP_RULES,
  GROUP_SENSITIVE_REPLY,
  GUARDRAILS,
} from '../src/ai/prompt.js';
import type { AiPrompt, AiProvider, AiRewritePrompt } from '../src/ai/provider-types.js';
import { createAiService } from '../src/ai/service.js';
import type { AppContext } from '../src/context.js';
import { createMessageService } from '../src/messages/service.js';
import { createPushService, type PushSender } from '../src/push/service.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

const G = '120363000000001@g.us';
const OWN = '60000000000@s.whatsapp.net';
const OWN_LID = '99000000000001@lid';
const FARAH = '60111111111@s.whatsapp.net';
const ARJUN = '60122222222@s.whatsapp.net';
const DM = '60133333333@s.whatsapp.net';

type Decision = { reply: string; action: string; handoffReason?: string | null };

let t: TestApp;
let decide: (prompt: AiPrompt) => Decision | Promise<Decision>;
let prompts: AiPrompt[];
/** The Open-chat decision and sensitive check (the fast draft call). */
let gate: (prompt: AiRewritePrompt) => GroupGateOutput | Promise<GroupGateOutput>;
let gatePrompts: AiRewritePrompt[];
let gateFast: boolean[];
let provider: AiProvider;
let adminId: number;
let agentId: number;
let aiUserId: number;
let actor: { userId: number; ip: string | null };
let seq = 0;

afterEach(async () => {
  await t?.close();
  vi.useRealTimers();
});

async function setUp(opts: { maxInboxes?: number; inboxes?: number; groups?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  prompts = [];
  gatePrompts = [];
  gateFast = [];
  decide = () => ({ reply: 'We open at 8am, Farah.', action: 'answer' });
  gate = () => ({ reach: 'chat', sensitive: false });
  provider = {
    generate: vi.fn(async (_s, _k, prompt: AiPrompt) => {
      prompts.push(prompt);
      return decide(prompt);
    }) as AiProvider['generate'],
    draft: vi.fn(async (_s, _k, prompt: AiRewritePrompt, options: { fast: boolean }) => {
      gatePrompts.push(prompt);
      gateFast.push(options.fast);
      return { output: await gate(prompt), model: 'fast-test' };
    }) as unknown as AiProvider['draft'],
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  t = await makeTestApp({
    wa: new FakeWaAdapter({ me: { jid: OWN, name: 'Kopi Apong', lid: OWN_LID } }),
    ...(opts.maxInboxes ? { maxInboxes: opts.maxInboxes } : {}),
    ...(opts.inboxes ? { inboxes: opts.inboxes } : {}),
    beforeBuild: async (ctx: AppContext) => {
      await ctx.services.ai!.shutdown();
      ctx.services.messages!.shutdown();
      ctx.services.messages = createMessageService(ctx, {
        now: () => Date.now(),
        queue: { spacingMs: 0 },
      });
      ctx.services.ai = createAiService(ctx, { provider, isOnline: () => true });
    },
  });
  adminId = t.ctx.services.auth!.createUser({
    username: 'admin',
    displayName: 'Admin',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  }).id;
  actor = { userId: adminId, ip: null };
  const ai = t.ctx.services.ai!;
  ai.saveConnection({ mode: 'api', model: '', apiKey: 'test-api-key-123' }, actor);
  ai.saveMember({ displayName: 'Aina', enabled: false, instructions: '' }, actor);
  ai.addText(null, { name: 'Business context', text: 'Kopi Apong opens 8am to 6pm.' }, actor);
  ai.saveMember({ displayName: 'Aina', enabled: true, instructions: '' }, actor);
  agentId = listAgents(t.ctx.db)[0]!.id;
  aiUserId = agentById(t.ctx.db, agentId)!.userId;
  getChats(t.ctx).upsertFromWa({ jid: G, type: 'group', name: 'Kopi Lovers Club' });
  if (opts.groups !== false) {
    setAgentGroups(t.ctx, agentId, { enabled: true }, actor);
    setGroupChat(t.ctx, G, 'default', actor);
  }
}

interface Incoming {
  from?: string;
  name?: string | null;
  mentions?: string[];
  quotedId?: string | null;
  source?: 'live' | 'history';
  fromMe?: boolean;
  chatJid?: string;
}

/** A group message as WhatsApp delivers it; returns its stored id. */
async function inGroup(body: string, o: Incoming = {}) {
  const id = `g-${++seq}`;
  await getMessages(t.ctx).ingest(
    {
      id,
      chatJid: o.chatJid ?? G,
      body,
      type: 'text',
      fromMe: o.fromMe ?? false,
      senderJid: o.fromMe ? null : (o.from ?? FARAH),
      senderName: o.fromMe ? null : o.name === undefined ? 'Farah Aziz' : o.name,
      timestamp: Date.now(),
      quotedId: o.quotedId ?? null,
      media: null,
      ...(o.mentions ? { mentionedJids: o.mentions } : {}),
    },
    o.source ?? 'live',
  );
  return id;
}
const tag = (body = '@60000000000 what time do you open?', o: Incoming = {}) =>
  inGroup(body, { mentions: [OWN], ...o });
const settle = () => vi.advanceTimersByTimeAsync(3000);
const sentToGroup = () => t.wa.sent.filter((s) => s.chatJid === G);
const groupLines = () =>
  getChats(t.ctx)
    .events(G)
    .filter((e) => e.type === 'ai_tool_used' && e.payload.group)
    .map((e) => e.payload.group as AiGroupEvent);
const aiMessageIds = () =>
  (
    t.ctx.db
      .prepare(
        "SELECT id FROM messages WHERE chat_jid = ? AND sent_by_user_id = ? AND status <> 'failed' ORDER BY timestamp, rowid",
      )
      .all(G, aiUserId) as Array<{ id: string }>
  ).map((r) => r.id);
/** A teammate writes in the group from the inbox (ends a run of AI answers). */
async function teammateWrites(text = 'Thanks all!') {
  getMessages(t.ctx).sendText(G, { text, clientId: `tm-${++seq}` }, adminId);
  await settle();
}

describe('addressed to the AI', { timeout: 30_000 }, () => {
  it('counts a tag of the own JID (any device) or LID and a quote of an AI answer only', async () => {
    await setUp();
    const check = (id: string, quotedId: string | null = null) =>
      addressedToAi(t.ctx, { chatJid: G, messageId: id, quotedId, aiUserId });
    const history = { source: 'history' as const };
    expect(
      check(
        await inGroup('@60000000000 hi', {
          ...history,
          mentions: ['60000000000:12@s.whatsapp.net'],
        }),
      ),
    ).toBe('tag');
    expect(check(await inGroup('@99000000000001 hi', { ...history, mentions: [OWN_LID] }))).toBe(
      'tag',
    );
    expect(check(await inGroup('@60122222222 hi', { ...history, mentions: [ARJUN] }))).toBeNull();
    expect(check(await inGroup('Kopi Apong, open now?', history))).toBeNull();
    const corrupt = await inGroup('@60000000000 hi', { ...history, mentions: [OWN] });
    t.ctx.db.prepare("UPDATE messages SET mentioned_jids = 'not json' WHERE id = ?").run(corrupt);
    expect(check(corrupt)).toBeNull();
    t.ctx.db.prepare("UPDATE messages SET mentioned_jids = '{}' WHERE id = ?").run(corrupt);
    expect(check(corrupt)).toBeNull();

    const insert = t.ctx.db.prepare(
      "INSERT INTO messages (id, chat_jid, type, body, timestamp, created_at, from_me, sent_by_user_id, status) VALUES (?, ?, 'text', 'x', ?, ?, 1, ?, 'sent')",
    );
    insert.run('ai-1', G, Date.now(), Date.now(), aiUserId);
    insert.run('tm-1', G, Date.now(), Date.now(), adminId);
    const asked = await inGroup('and on Sunday?', history);
    expect(check(asked, 'ai-1')).toBe('quote');
    expect(check(asked, 'tm-1')).toBeNull();
    expect(check(asked, 'missing')).toBeNull();
  });

  it('names members without numbers and hides numeric tags', async () => {
    await setUp();
    const base = { senderJid: FARAH, senderName: 'Farah Aziz', senderProfile: null } as Message;
    expect(memberName(t.ctx, base)).toBe('Farah Aziz');
    expect(memberName(t.ctx, { ...base, senderName: '+60 11-111 1111' })).toBeNull();
    expect(memberName(t.ctx, { ...base, senderJid: null, senderName: null })).toBeNull();
    expect(
      memberName(t.ctx, { ...base, senderProfile: { chatJid: FARAH, name: 'Farah (VIP)' } }),
    ).toBe('Farah (VIP)');
    t.ctx.db
      .prepare("INSERT INTO contacts (jid, saved_name, push_name) VALUES (?, 'Cik Farah', NULL)")
      .run(FARAH);
    expect(memberName(t.ctx, base)).toBe('Cik Farah');
    expect(groupText('@60111111111 and @Aina, @12 ok')).toBe('@member and @Aina, @12 ok');
  });
});

describe('answers in a group', { timeout: 30_000 }, () => {
  it('answers a tag quoting the member, never taking the group', async () => {
    await setUp();
    const daniel = t.ctx.services.auth!.createUser({
      username: 'daniel',
      displayName: 'Daniel',
      role: 'agent',
      password: 'password123',
      mustChangePassword: false,
    });
    getChats(t.ctx).patch(G, { assignedTo: daniel.id }, adminId);
    await inGroup('Morning all!', { from: ARJUN, name: '60122222222' });
    const asked = await tag();
    await settle();
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(sentToGroup()).toHaveLength(1);
    expect(sentToGroup()[0]).toMatchObject({ text: 'We open at 8am, Farah.' });
    expect((sentToGroup()[0] as { reply?: { quotedId: string } }).reply?.quotedId).toBe(asked);
    expect(getChats(t.ctx).get(G)!.assignedTo).toBe(daniel.id);
    expect(groupLines()).toEqual([{ kind: 'answered', member: 'Farah Aziz' }]);
    expect(
      t.ctx.db.prepare('SELECT count(*) AS n FROM ai_chat_state WHERE chat_jid = ?').get(G),
    ).toEqual({ n: 0 });

    const prompt = prompts[0]!;
    expect(prompt.instructions).toContain(GROUP_RULES);
    const input = JSON.parse(prompt.input) as {
      conversation: Array<{ speaker: string; name?: string; text: string }>;
      currentSituation: { group: Record<string, string>; resolution?: string };
    };
    expect(input.currentSituation.group).toMatchObject({
      name: 'Kopi Lovers Club',
      askingMember: 'Farah Aziz',
      addressedBy: 'The member tagged the business.',
    });
    expect(input.currentSituation.resolution).toBeUndefined();
    expect(input.conversation).toEqual([
      { speaker: 'customer', name: 'Member', text: 'Morning all!' },
      { speaker: 'customer', name: 'Farah Aziz', text: expect.stringContaining('what time') },
    ]);
    expect(prompt.input).not.toMatch(/60111111111|60122222222|60000000000/);
  });

  it('answers any member who quotes an AI answer, without a tag', async () => {
    await setUp();
    await tag();
    await settle();
    const answer = aiMessageIds()[0]!;
    decide = () => ({ reply: 'Yes, Arjun, Sundays too.', action: 'ask_resolution' });
    const asked = await inGroup('Sunday also?', { from: ARJUN, name: 'Arjun', quotedId: answer });
    await settle();
    expect(sentToGroup().map((s) => s.text)).toEqual([
      'We open at 8am, Farah.',
      'Yes, Arjun, Sundays too.',
    ]);
    expect((sentToGroup()[1] as { reply?: { quotedId: string } }).reply?.quotedId).toBe(asked);
    expect(groupLines()[1]).toEqual({ kind: 'answered', member: 'Arjun', quoted: true });
    const input = JSON.parse(prompts[1]!.input) as {
      currentSituation: { group: Record<string, string> };
    };
    expect(input.currentSituation.group.addressedBy).toBe(
      'The member replied to your earlier answer.',
    );
  });

  it('stays silent for every message that is not addressed to the AI', async () => {
    await setUp();
    await teammateWrites('Hello from the team');
    const teammate = (
      t.ctx.db
        .prepare('SELECT id FROM messages WHERE chat_jid = ? AND sent_by_user_id = ?')
        .get(G, adminId) as { id: string }
    ).id;
    await inGroup('Anyone tried the pandan toast?');
    await inGroup('@60122222222 you?', { mentions: [ARJUN] });
    await inGroup('Thanks!', { quotedId: teammate });
    await tag(undefined, { source: 'history' });
    await tag('@60000000000 note to self', { fromMe: true });
    await settle();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(sentToGroup()).toHaveLength(1);
    expect(groupLines()).toEqual([]);
  });

  it('does nothing while any switch is off', async () => {
    await setUp({ groups: false });
    const ai = t.ctx.services.ai!;
    await tag();
    await settle();
    setAgentGroups(t.ctx, agentId, { enabled: true }, actor);
    await tag();
    await settle();
    setGroupChat(t.ctx, G, 'default', actor);
    ai.saveMember({ displayName: 'Aina', enabled: false, instructions: '' }, actor);
    await tag();
    await settle();
    expect(provider.generate).not.toHaveBeenCalled();
    ai.saveMember({ displayName: 'Aina', enabled: true, instructions: '' }, actor);
    await tag();
    await settle();
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('stops a waiting answer when the group or the agent switch goes off', async () => {
    await setUp();
    await tag();
    setGroupChat(t.ctx, G, 'off', actor);
    await settle();
    setGroupChat(t.ctx, G, 'default', actor);
    await tag();
    setAgentGroups(t.ctx, agentId, { enabled: false }, actor);
    await settle();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(sentToGroup()).toHaveLength(0);
  });

  it('hands over with the group line, an event, an audit row and a notification', async () => {
    await setUp();
    decide = () => ({
      reply: 'Someone will help',
      action: 'handoff',
      handoffReason: 'needs_action',
    });
    const events: Array<{ member: string | null; question: string; agentName: string }> = [];
    t.ctx.bus.on('ai:group_handoff', (e) => events.push(e));
    const asked = await tag('@60000000000 can you book a table for 6 tonight?');
    await settle();
    expect(sentToGroup().map((s) => s.text)).toEqual([GROUP_HANDOVER_REPLY]);
    expect((sentToGroup()[0] as { reply?: { quotedId: string } }).reply?.quotedId).toBe(asked);
    expect(groupLines()).toEqual([{ kind: 'handover', member: 'Farah Aziz' }]);
    expect(events).toEqual([
      expect.objectContaining({
        agentName: 'Aina',
        member: 'Farah Aziz',
        question: expect.stringContaining('book a table'),
      }),
    ]);
    const audit = t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'ai.group_handoff'")
      .get() as { meta: string };
    expect(JSON.parse(audit.meta)).toEqual({ chatJid: G, agentId, reason: 'needs_action' });
    expect(getChats(t.ctx).get(G)!.assignedTo).toBeNull();
  });

  it('sends nothing for no_reply and an empty answer', async () => {
    await setUp();
    decide = () => ({ reply: '', action: 'no_reply' });
    await tag('@60000000000 👍');
    await settle();
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(sentToGroup()).toHaveLength(0);
    expect(groupLines()).toEqual([]);
  });

  it('hands over without a model call when facts are missing or the tag has no text', async () => {
    await setUp();
    const ai = t.ctx.services.ai!;
    await tag();
    await settle();
    const sticker = await getMessages(t.ctx).ingest(
      {
        id: 'sticker-1',
        chatJid: G,
        body: null,
        type: 'sticker',
        fromMe: false,
        senderJid: FARAH,
        senderName: 'Farah Aziz',
        timestamp: Date.now(),
        quotedId: aiMessageIds()[0]!,
        media: null,
      },
      'live',
    );
    expect(sticker).not.toBeNull();
    await settle();
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(groupLines().at(-1)).toEqual({ kind: 'handover', member: 'Farah Aziz' });
    const doc = ai.status().documents[0]!;
    ai.removeDocument(null, doc.id, actor);
    await tag();
    await settle();
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(sentToGroup().map((s) => s.text)).toEqual([
      'We open at 8am, Farah.',
      GROUP_HANDOVER_REPLY,
      GROUP_HANDOVER_REPLY,
    ]);
  });

  it('hands over when the model fails or the reply quotes an Internal item', async () => {
    await setUp();
    const secret = 'Our supplier cost for the kopi beans is RM12 per kilogram this month.';
    t.ctx.services.ai!.addText(null, { name: 'Costs', text: secret, internal: true }, actor);
    decide = () => {
      throw new Error('boom');
    };
    await tag();
    await settle();
    decide = () => ({ reply: `Sure: ${secret}`, action: 'answer' });
    await tag();
    await settle();
    expect(sentToGroup().map((s) => s.text)).toEqual([GROUP_HANDOVER_REPLY, GROUP_HANDOVER_REPLY]);
    expect(
      (
        t.ctx.db
          .prepare("SELECT meta FROM audit_log WHERE action = 'ai.group_handoff' ORDER BY id")
          .all() as Array<{ meta: string }>
      ).map((r) => JSON.parse(r.meta).reason),
    ).toEqual(['ai_unavailable', 'confidential_leak']);
  });

  it('answers at most five waiting questions of a burst, and skips one pushed out of view', async () => {
    await setUp();
    for (let i = 0; i < 7; i++) await tag(`@60000000000 question ${i}`);
    await settle();
    await settle();
    expect(provider.generate).toHaveBeenCalledTimes(5);

    await tag('@60000000000 lost question');
    for (let i = 0; i < 21; i++) await inGroup(`chatter ${i}`, { from: ARJUN, name: 'Arjun' });
    await settle();
    expect(provider.generate).toHaveBeenCalledTimes(5);
  });
});

describe('loop guard', { timeout: 60_000 }, () => {
  it('pauses after the limit with one line per run, until a teammate writes', async () => {
    await setUp();
    for (let i = 0; i < AI_GROUP_LOOP_GUARD; i++) {
      await tag(`@60000000000 question ${i}`);
      await settle();
    }
    expect(provider.generate).toHaveBeenCalledTimes(AI_GROUP_LOOP_GUARD);
    expect(loopGuard(t.ctx.db, G)).toMatchObject({ inRow: AI_GROUP_LOOP_GUARD, paused: true });
    expect(groupChatStatus(t.ctx, G).paused).toBe(true);

    const last = aiMessageIds().at(-1)!;
    await inGroup('auto-reply: thanks for your message', {
      from: ARJUN,
      name: 'Bot',
      quotedId: last,
    });
    await tag();
    await settle();
    expect(provider.generate).toHaveBeenCalledTimes(AI_GROUP_LOOP_GUARD);
    expect(groupLines().filter((l) => l.kind === 'paused')).toEqual([
      { kind: 'paused', member: null },
    ]);
    // In Open chat while paused: no decision call for chatter that could never be answered.
    setGroupChat(t.ctx, G, 'open', actor);
    gate = () => ({ reach: 'open', sensitive: false });
    const gateCalls = gatePrompts.length;
    await inGroup('Anyone know the price of Kopi O?', { from: ARJUN, name: 'Arjun Pillai' });
    await settle();
    expect(gatePrompts).toHaveLength(gateCalls);

    await teammateWrites();
    expect(loopGuard(t.ctx.db, G).paused).toBe(false);
    await tag();
    await settle();
    expect(provider.generate).toHaveBeenCalledTimes(AI_GROUP_LOOP_GUARD + 1);
  });
});

describe('notifications', { timeout: 30_000 }, () => {
  it('tells the assignee, else everyone who may open the inbox, naming group and member', async () => {
    await setUp();
    t.ctx.services.push!.shutdown();
    const sent: Array<{ endpoint: string; payload: Record<string, string> }> = [];
    const sender: PushSender = async (sub, payload) => {
      const parsed = JSON.parse(payload) as Record<string, string>;
      // only the hand-over notifications (every group message also notifies as usual)
      if (parsed.title?.includes('needs you'))
        sent.push({ endpoint: sub.endpoint, payload: parsed });
    };
    const push = createPushService(t.ctx, { sender });
    t.ctx.services.push = push;
    const daniel = t.ctx.services.auth!.createUser({
      username: 'daniel',
      displayName: 'Daniel',
      role: 'agent',
      password: 'password123',
      mustChangePassword: false,
    });
    const sub = (name: string): PushSubscribeBody => ({
      endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
      keys: { p256dh: 'p', auth: 'a' },
    });
    push.subscribe(adminId, sub('admin'));
    push.subscribe(daniel.id, sub('daniel'));
    decide = () => ({ reply: 'x', action: 'handoff', handoffReason: 'needs_action' });
    await tag('@60000000000 please call me');
    await settle();
    expect(sent.map((s) => s.endpoint.split('/').at(-1)).sort()).toEqual(['admin', 'daniel']);
    expect(sent[0]!.payload).toMatchObject({
      title: 'Aina needs you in Kopi Lovers Club',
      body: 'Farah Aziz: @Kopi Apong please call me',
      url: `/chats/${encodeURIComponent(G)}`,
    });

    sent.length = 0;
    getChats(t.ctx).patch(G, { assignedTo: daniel.id }, adminId);
    await tag('@60000000000 hello?', { name: '0123' });
    await settle();
    expect(sent.map((s) => s.endpoint.split('/').at(-1))).toEqual(['daniel']);
    expect(sent[0]!.payload.body).toBe('A member: @Kopi Apong hello?');
    push.shutdown();
  });
});

describe('Open chat and sensitive topics', { timeout: 30_000 }, () => {
  const openChat = () => setGroupChat(t.ctx, G, 'open', actor);
  const situation = (i = -1) =>
    (JSON.parse(prompts.at(i)!.input) as { currentSituation: { group: { addressedBy: string } } })
      .currentSituation.group;

  it('answers no untagged message in Tag and quote, and makes no gate call for it', async () => {
    await setUp();
    gate = () => ({ reach: 'open', sensitive: false });
    await inGroup('Anyone know what time Kopi Apong opens?');
    await settle();
    expect(gatePrompts).toHaveLength(0);
    expect(sentToGroup()).toHaveLength(0);
  });

  it('answers an open question in Open chat, marked as open chat, from a gate without knowledge', async () => {
    await setUp();
    openChat();
    gate = () => ({ reach: 'open', sensitive: false });
    await inGroup('Anyone know what time Kopi Apong opens?', { from: ARJUN, name: 'Arjun Pillai' });
    await settle();
    expect(gateFast).toEqual([true]);
    expect(gatePrompts[0]!.instructions).toBe(GROUP_GATE_RULES);
    const input = JSON.parse(gatePrompts[0]!.input) as Record<string, unknown>;
    expect(input).toMatchObject({
      agentName: 'Aina',
      groupName: 'Kopi Lovers Club',
      inConversation: false,
      message: { member: 'Arjun Pillai', text: 'Anyone know what time Kopi Apong opens?' },
    });
    expect(gatePrompts[0]!.input).not.toContain('8am to 6pm');
    expect(gatePrompts[0]!.cacheId).toMatch(/#agent:\d+#group-gate$/);
    expect(sentToGroup()).toHaveLength(1);
    expect(situation().addressedBy).toBe(
      'The member asked the whole group a question about the business.',
    );
    expect(groupLines().at(-1)).toEqual({
      kind: 'answered',
      member: 'Arjun Pillai',
      openChat: true,
    });
  });

  it('stays silent for a question to a person, members chatting, a member tag or a failed gate', async () => {
    await setUp();
    openChat();
    for (const reach of ['person', 'chat'] as const) {
      gate = () => ({ reach, sensitive: false });
      await inGroup('Siti, are you coming on Saturday?');
      await settle();
    }
    expect(gatePrompts).toHaveLength(2);
    await inGroup('@60122222222 can you send the file?', { mentions: [ARJUN] });
    await inGroup('');
    await settle();
    expect(gatePrompts).toHaveLength(2);
    gate = () => {
      throw new Error('fast model down');
    };
    await inGroup('Does anyone know the price of Kopi O?');
    await settle();
    expect(sentToGroup()).toHaveLength(0);
    expect(provider.generate).not.toHaveBeenCalled();
    // A tag is still answered when the gate fails (the guardrails keep sensitive topics out).
    await tag();
    await settle();
    expect(sentToGroup()).toHaveLength(1);
  });

  it('answers its name, and a follow-up only from the member it is talking with', async () => {
    await setUp();
    openChat();
    gate = () => ({ reach: 'named', sensitive: false });
    await inGroup('Aina, are you open on Sunday?');
    await settle();
    expect(situation().addressedBy).toBe('The member named you.');
    gate = () => ({ reach: 'continue', sensitive: false });
    await inGroup('and on public holidays?');
    await settle();
    expect(JSON.parse(gatePrompts.at(-1)!.input).inConversation).toBe(true);
    expect(situation().addressedBy).toBe('The member went on talking with you after your answer.');
    expect(sentToGroup()).toHaveLength(2);
    // Arjun is not in the conversation: a "continue" from him is not for the AI.
    await inGroup('same for me?', { from: ARJUN, name: 'Arjun Pillai' });
    await settle();
    expect(JSON.parse(gatePrompts.at(-1)!.input).inConversation).toBe(false);
    expect(sentToGroup()).toHaveLength(2);
    // A teammate's message ends the conversation.
    await teammateWrites();
    await inGroup('and at night?');
    await settle();
    expect(JSON.parse(gatePrompts.at(-1)!.input).inConversation).toBe(false);
    expect(sentToGroup().filter((s) => s.text !== 'Thanks all!')).toHaveLength(2);
    expect(openChatReaches({ reach: 'continue', sensitive: false }, false)).toBe(false);
  });

  it('writes the polite line for a tagged sensitive question and stays silent otherwise', async () => {
    await setUp();
    openChat();
    gate = () => ({ reach: 'open', sensitive: true });
    await inGroup('who will win the election?');
    await settle();
    expect(sentToGroup()).toHaveLength(0);
    await tag('@60000000000 who will win the election?');
    await settle();
    expect(sentToGroup()).toHaveLength(1);
    expect(sentToGroup()[0]).toMatchObject({ text: GROUP_SENSITIVE_REPLY });
    expect(groupLines().at(-1)).toEqual({ kind: 'declined', member: 'Farah Aziz' });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(GUARDRAILS).toContain('Never discuss politics, race, religion or gender');
    // The polite line ends the conversation: Farah's next untagged message is not a follow-up.
    gate = () => ({ reach: 'continue', sensitive: false });
    await inGroup('ok, then what time do you open?');
    await settle();
    expect(JSON.parse(gatePrompts.at(-1)!.input).inConversation).toBe(false);
    expect(sentToGroup()).toHaveLength(1);
  });

  it('keeps room for tags when chatter fills the queue, and decides each message on what came before it', async () => {
    await setUp();
    openChat();
    gate = () => ({ reach: 'chat', sensitive: false });
    for (let i = 0; i < 6; i++) await inGroup(`hello ${i}`, { from: ARJUN, name: 'Arjun Pillai' });
    for (let i = 0; i < 3; i++) await tag(`@60000000000 question ${i}`);
    await settle();
    await settle();
    // At most 3 untagged messages wait; the third tag took the place of the oldest one.
    expect(sentToGroup()).toHaveLength(3);
    const decided = gatePrompts.map(
      (p) => (JSON.parse(p.input) as { message: { text: string } }).message.text,
    );
    expect(decided.filter((text) => text.startsWith('hello'))).toEqual(['hello 1', 'hello 2']);
    // The first decision sees only the messages before "hello 1", never the later ones.
    const seen = (
      JSON.parse(gatePrompts[0]!.input) as { conversation: Array<{ text: string }> }
    ).conversation.map((turn) => turn.text);
    expect(seen).toContain('hello 0');
    expect(seen).not.toContain('hello 2');
  });

  it('still answers a waiting tag when the group goes from Open chat to Tag and quote', async () => {
    await setUp();
    openChat();
    gate = () => ({ reach: 'open', sensitive: false });
    await tag();
    setGroupChat(t.ctx, G, 'tag', actor);
    await settle();
    expect(sentToGroup()).toHaveLength(1);
    // Choosing the mode it already has stops nothing either.
    await tag();
    setAgentGroups(t.ctx, agentId, { mode: 'tag' }, actor);
    await settle();
    expect(sentToGroup()).toHaveLength(2);
  });

  it('answers a group never set in all groups, in the agent mode, and not in selected groups', async () => {
    await setUp({ groups: false });
    setAgentGroups(t.ctx, agentId, { enabled: true, scope: 'all', mode: 'open' }, actor);
    expect(groupChatStatus(t.ctx, G)).toMatchObject({ setting: 'default', mode: 'open' });
    gate = () => ({ reach: 'open', sensitive: false });
    await inGroup('Anyone know if they deliver?');
    await settle();
    expect(sentToGroup()).toHaveLength(1);
    setAgentGroups(t.ctx, agentId, { scope: 'selected' }, actor);
    expect(groupChatStatus(t.ctx, G)).toMatchObject({ setting: 'off', mode: 'off' });
    await tag();
    await settle();
    expect(sentToGroup()).toHaveLength(1);
  });

  it('builds a bounded gate prompt', () => {
    const built = buildGroupGatePrompt({
      agentName: 'Aina',
      role: 'x'.repeat(5_000),
      groupName: 'Club',
      inConversation: true,
      conversation: Array.from({ length: 30 }, (_, i) => ({
        speaker: 'customer' as const,
        name: 'M',
        text: String(i),
      })),
      member: 'Farah',
      text: 'hi',
    });
    const input = JSON.parse(built.input) as {
      role: string;
      conversation: Array<{ text: string }>;
    };
    expect(input.role).toHaveLength(1_000);
    expect(input.conversation.map((turn) => turn.text)).toEqual(
      Array.from({ length: 8 }, (_, i) => String(22 + i)),
    );
  });

  it('keeps factual business questions (halal, festive hours, women or men) out of the sensitive topics', async () => {
    // A halal question is the most common one in Malaysia: neither the gate nor the guardrails may refuse it.
    const { GUARDRAILS } = await import('../src/ai/prompt.js');
    for (const text of [GROUP_GATE_RULES, GUARDRAILS]) {
      expect(text).toMatch(/politics, race, religion or gender/);
      expect(text).toMatch(/halal food, opening hours on a festive or prayer day/);
    }
  });
});

describe('Try it: group question', { timeout: 30_000 }, () => {
  it('answers as in a group: group rules, the group line on hand-over, no resolution', async () => {
    await setUp();
    const ai = t.ctx.services.ai!;
    const body = {
      question: 'What time do you open?',
      knowledge: { displayName: 'Aina', instructions: '' },
      agentId,
      group: true,
    };
    decide = () => ({ reply: 'From 8am!', action: 'ask_resolution' });
    expect(await ai.tryAnswer(body)).toMatchObject({
      ok: true,
      reply: 'From 8am!',
      action: 'answer',
    });
    expect(prompts[0]!.instructions).toContain(GROUP_RULES);
    expect(JSON.parse(prompts[0]!.input).currentSituation.group.askingMember).toBe('Member');
    decide = () => ({ reply: 'Wait', action: 'handoff', handoffReason: 'asked_for_human' });
    expect(await ai.tryAnswer(body)).toMatchObject({
      reply: GROUP_HANDOVER_REPLY,
      action: 'handoff',
      handoffReason: 'asked_for_human',
    });
    decide = () => ({ reply: '', action: 'no_reply' });
    expect(await ai.tryAnswer(body)).toMatchObject({ reply: '', action: 'no_reply' });
    decide = () => ({ reply: 'From 8am!', action: 'ask_resolution' });
    expect(await ai.tryAnswer({ ...body, group: false })).toMatchObject({
      action: 'ask_resolution',
    });
    expect(prompts.at(-1)!.instructions).not.toContain(GROUP_RULES);

    ai.removeDocument(null, ai.status().documents[0]!.id, actor);
    expect(await ai.tryAnswer(body)).toMatchObject({
      reply: GROUP_HANDOVER_REPLY,
      action: 'handoff',
    });
  });
});

describe('routes', { timeout: 30_000 }, () => {
  type Method = 'GET' | 'PUT';
  const call = (method: Method, url: string, cookie?: string, payload?: object) =>
    t.app.inject({
      method,
      url,
      headers: cookie ? authHeaders(cookie) : { origin: 'http://localhost', host: 'localhost' },
      ...(payload ? { payload } : {}),
    });

  it('serve the agent switch and the group switch with their rules and audit rows', async () => {
    await setUp();
    const admin = await createUserAndLogin(t, { role: 'admin' });
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const groups = `/api/ai/agents/${agentId}/groups`;
    const group = `/api/chats/${encodeURIComponent(G)}/ai-group`;

    const listed = await call('GET', groups, admin.cookie);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toEqual({
      enabled: true,
      scope: 'selected',
      mode: 'tag',
      inboxName: t.ctx.inboxes.repo.get(1)!.name,
      groups: [
        {
          jid: G,
          name: 'Kopi Lovers Club',
          memberCount: null,
          enabled: true,
          setting: 'default',
          mode: 'tag',
          paused: false,
        },
      ],
      loopGuard: AI_GROUP_LOOP_GUARD,
    });
    // Scope and default mode: a group never set follows the scope; "default" follows the mode.
    const other = '120363000000077@g.us';
    getChats(t.ctx).upsertFromWa({ jid: other, type: 'group', name: 'Aunties Corner' });
    const selected = (await call('GET', groups, admin.cookie)).json();
    expect(selected.groups[0]).toMatchObject({ jid: other, setting: 'off', mode: 'off' });
    const all = await call('PUT', groups, admin.cookie, { scope: 'all', mode: 'open' });
    expect(all.json()).toMatchObject({ enabled: true, scope: 'all', mode: 'open' });
    expect(
      all.json().groups.map((g: { setting: string; mode: string }) => [g.setting, g.mode]),
    ).toEqual([
      ['default', 'open'],
      ['default', 'open'],
    ]);
    await call('PUT', groups, admin.cookie, { scope: 'selected', mode: 'tag' });
    expect((await call('PUT', groups, admin.cookie, {})).statusCode).toBe(400);
    expect((await call('PUT', groups, admin.cookie, { scope: 'some' })).statusCode).toBe(400);
    const off = await call('PUT', groups, admin.cookie, { enabled: false });
    expect(off.json().enabled).toBe(false);
    expect((await call('PUT', groups, admin.cookie, { enabled: 'yes' })).statusCode).toBe(400);
    expect((await call('PUT', groups, admin.cookie, { enabled: true, x: 1 })).statusCode).toBe(400);
    const missing = await call('GET', '/api/ai/agents/999/groups', admin.cookie);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('agent_not_found');
    expect(
      (await call('PUT', '/api/ai/agents/999/groups', admin.cookie, { enabled: true })).statusCode,
    ).toBe(404);

    const status = await call('GET', group, agent.cookie);
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({
      enabled: true,
      setting: 'default',
      mode: 'tag',
      agentMode: 'tag',
      agentScope: 'selected',
      agentId,
      agentName: 'Aina',
      agentEnabled: true,
      agentAnswersGroups: false,
      paused: false,
    });
    const open = await call('PUT', group, admin.cookie, { setting: 'open' });
    expect(open.json()).toMatchObject({ enabled: true, setting: 'open', mode: 'open' });
    const tagOnly = await call('PUT', group, admin.cookie, { setting: 'tag' });
    expect(tagOnly.json()).toMatchObject({ setting: 'tag', mode: 'tag' });
    expect((await call('PUT', group, admin.cookie, { setting: 'loud' })).statusCode).toBe(400);
    expect(
      (await call('PUT', group, admin.cookie, { setting: 'off', enabled: true })).statusCode,
    ).toBe(400);
    // The earlier body still works: true = the agent's default mode, false = Off.
    const legacy = await call('PUT', group, admin.cookie, { enabled: true });
    expect(legacy.json()).toMatchObject({ enabled: true, setting: 'default' });
    const put = await call('PUT', group, admin.cookie, { enabled: false });
    expect(put.json()).toMatchObject({
      enabled: false,
      setting: 'off',
      mode: 'off',
      agentEnabled: true,
    });
    expect((await call('PUT', group, admin.cookie, {})).statusCode).toBe(400);

    getChats(t.ctx).upsertFromWa({ jid: DM, type: 'dm', name: 'Mei' });
    const direct = await call('GET', `/api/chats/${encodeURIComponent(DM)}/ai-group`, agent.cookie);
    expect(direct.statusCode).toBe(400);

    for (const [method, url, body] of [
      ['GET', groups],
      ['PUT', groups, { enabled: true }],
      ['PUT', group, { enabled: true }],
    ] as Array<[Method, string, object?]>) {
      expect((await call(method, url, agent.cookie, body)).statusCode, `${method} ${url}`).toBe(
        403,
      );
      expect((await call(method, url, undefined, body)).statusCode, `${method} ${url}`).toBe(401);
    }
    expect((await call('GET', group)).statusCode).toBe(401);

    const audits = (
      t.ctx.db
        .prepare(
          "SELECT action, meta FROM audit_log WHERE action IN ('ai.groups_switch', 'ai.group_switch') ORDER BY id",
        )
        .all() as Array<{ action: string; meta: string }>
    ).map((r) => [r.action, JSON.parse(r.meta)]);
    expect(
      audits.find(([action, meta]) => action === 'ai.groups_switch' && meta.scope === 'all'),
    ).toEqual(['ai.groups_switch', { agentId, agentName: 'Aina', scope: 'all', mode: 'open' }]);
    expect(audits.filter(([action]) => action === 'ai.groups_switch').at(-1)).toEqual([
      'ai.groups_switch',
      { agentId, agentName: 'Aina', enabled: false },
    ]);
    expect(audits.at(-1)).toEqual([
      'ai.group_switch',
      { chatJid: G, groupName: 'Kopi Lovers Club', setting: 'off', enabled: false },
    ]);
  });

  it('lists no groups for an agent without an inbox, and lets the fake phone quote', async () => {
    await setUp();
    const admin = await createUserAndLogin(t, { role: 'admin' });
    await tag();
    await settle();
    const answer = aiMessageIds()[0]!;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/dev/fake-incoming',
      headers: authHeaders(admin.cookie),
      payload: {
        chatJid: G,
        text: 'and Sunday?',
        senderJid: ARJUN,
        senderName: 'Arjun',
        quotedId: answer,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const stored = t.ctx.db
      .prepare('SELECT quoted_id FROM messages WHERE id = ?')
      .get(res.json().id) as { quoted_id: string };
    expect(stored.quoted_id).toBe(answer);
    await settle();
    expect(groupLines().at(-1)).toEqual({ kind: 'answered', member: 'Arjun', quoted: true });

    t.ctx.db.prepare('UPDATE ai_agents SET inbox_id = NULL WHERE id = ?').run(agentId);
    const listed = await call('GET', `/api/ai/agents/${agentId}/groups`, admin.cookie);
    expect(listed.json()).toMatchObject({ inboxName: null, groups: [] });
    const status = await call('GET', `/api/chats/${encodeURIComponent(G)}/ai-group`, admin.cookie);
    expect(status.json()).toMatchObject({
      agentId: null,
      agentEnabled: false,
      agentAnswersGroups: false,
    });
  });

  it('answers 404 for a group outside the caller’s inboxes', async () => {
    await setUp({ maxInboxes: 2, inboxes: 2 });
    const agent = await createUserAndLogin(t, { role: 'agent' });
    t.ctx.inboxes.repo.setUserInboxes(agent.user.id, [2]);
    const res = await call('GET', `/api/chats/${encodeURIComponent(G)}/ai-group`, agent.cookie);
    expect(res.statusCode).toBe(404);
  });
});

describe('migrations 024 and 025', { timeout: 30_000 }, () => {
  it('adds the agent switch (off) and the group switch table', async () => {
    await setUp({ groups: false });
    const columns = t.ctx.db.prepare('PRAGMA table_info(ai_agents)').all() as Array<{
      name: string;
      dflt_value: string | null;
    }>;
    expect(columns.find((c) => c.name === 'answer_groups')?.dflt_value).toBe('0');
    expect(agentById(t.ctx.db, agentId)!.answerGroups).toBe(false);
    const table = t.ctx.db.prepare('PRAGMA table_info(ai_group_chats)').all() as Array<{
      name: string;
    }>;
    expect(table.map((c) => c.name)).toEqual([
      'chat_jid',
      'enabled',
      'updated_at',
      'updated_by',
      'setting',
    ]);
    // 025: existing agents keep selected groups only and Tag and quote.
    expect(agentById(t.ctx.db, agentId)).toMatchObject({
      groupScope: 'selected',
      groupMode: 'tag',
    });
  });
});
