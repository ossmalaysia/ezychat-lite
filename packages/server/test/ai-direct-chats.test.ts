// "Answer direct chats" (docs/features/ai-direct-chats/design.md): off makes a group-only agent. It
// never answers or takes a direct chat, cannot be assigned one, returns the ones it holds to the team,
// and keeps answering tags in its groups. An inbox without groups ignores the switch. Mock model only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryUser } from '@ezychat/shared';
import { FakeWaAdapter, type WaAdapter } from '@ezychat/wa';
import { agentById, listAgents, setAgentAnswerDirect, type AgentRow } from '../src/ai/agents.js';
import { answersDirect, inboxHasGroups } from '../src/ai/direct.js';
import { agentGroups, setAgentDirect, setAgentGroups, setGroupChat } from '../src/ai/groups.js';
import type { AiPrompt, AiProvider } from '../src/ai/provider-types.js';
import { createAiService } from '../src/ai/service.js';
import type { AppContext } from '../src/context.js';
import { createMessageService } from '../src/messages/service.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

const G = '120363000000001@g.us';
const OWN = '60000000000@s.whatsapp.net';
const FARAH = '60111111111@s.whatsapp.net';
const DM = '60133333333@s.whatsapp.net';

let t: TestApp;
let prompts: AiPrompt[];
let agentId: number;
let aiUserId: number;
let actor: { userId: number; ip: string | null };
let seq = 0;

afterEach(async () => {
  await t?.close();
  vi.useRealTimers();
});

async function setUp() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  prompts = [];
  const provider: AiProvider = {
    generate: vi.fn(async (_s, _k, prompt: AiPrompt) => {
      prompts.push(prompt);
      return { reply: 'We open at 8am.', action: 'answer' };
    }) as AiProvider['generate'],
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  t = await makeTestApp({
    wa: new FakeWaAdapter({ me: { jid: OWN, name: 'Kopi Apong' } }),
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
  const adminId = t.ctx.services.auth!.createUser({
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
  getChats(t.ctx).upsertFromWa({ jid: DM, type: 'dm', name: 'Mei' });
  setAgentGroups(t.ctx, agentId, true, actor);
  setGroupChat(t.ctx, G, true, actor);
}

async function incoming(chatJid: string, body: string, mentions?: string[]) {
  await getMessages(t.ctx).ingest(
    {
      id: `m-${++seq}`,
      chatJid,
      body,
      type: 'text',
      fromMe: false,
      senderJid: chatJid === G ? FARAH : chatJid,
      senderName: 'Mei',
      timestamp: Date.now(),
      quotedId: null,
      media: null,
      ...(mentions ? { mentionedJids: mentions } : {}),
    },
    'live',
  );
}
/** Past the unassigned-chat fallback (AI_FALLBACK_MS) and the group debounce. */
const settle = () => vi.advanceTimersByTimeAsync(15_000);
const sentTo = (jid: string) => t.wa.sent.filter((s) => s.chatJid === jid);
const dm = () => getChats(t.ctx).get(DM)!;

describe('Answer direct chats', { timeout: 30_000 }, () => {
  it('is on for every agent by default and answers direct chats as before', async () => {
    await setUp();
    expect(agentById(t.ctx.db, agentId)!.answerDirect).toBe(true);
    expect(agentGroups(t.ctx, agentId)).toMatchObject({
      answerDirect: true,
      directAvailable: true,
      heldDirect: 0,
    });
    await incoming(DM, 'What time do you open?');
    await settle();
    expect(dm().assignedTo).toBe(aiUserId);
    expect(sentTo(DM)).toHaveLength(1);
    expect(agentGroups(t.ctx, agentId).heldDirect).toBe(1);
  });

  it('off: never answers or takes a direct chat, still answers a tag in its group', async () => {
    await setUp();
    setAgentDirect(t.ctx, agentId, false, actor);
    await incoming(DM, 'What time do you open?');
    await settle();
    expect(dm().assignedTo).toBeNull();
    expect(sentTo(DM)).toHaveLength(0);

    await incoming(G, '@60000000000 what time do you open?', [OWN]);
    await settle();
    expect(sentTo(G)).toHaveLength(1);
    expect(prompts).toHaveLength(1);
  });

  it('turning it off returns held direct chats to the team and stops a pending reply', async () => {
    await setUp();
    await incoming(DM, 'What time do you open?');
    await settle();
    expect(dm().assignedTo).toBe(aiUserId);

    // A new question is waiting for the AI when the switch goes off.
    await incoming(DM, 'And on Sunday?');
    const view = setAgentDirect(t.ctx, agentId, false, actor);
    expect(view).toMatchObject({ answerDirect: false, heldDirect: 0 });
    await settle();
    expect(dm().assignedTo).toBeNull();
    expect(sentTo(DM)).toHaveLength(1);

    const audit = t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'ai.direct_switch' ORDER BY id DESC")
      .get() as { meta: string };
    expect(JSON.parse(audit.meta)).toEqual({ agentId, agentName: 'Aina', enabled: false });

    // On again: a released chat stays with the team (as when an agent is turned off); a new
    // direct chat is answered.
    setAgentDirect(t.ctx, agentId, true, actor);
    await incoming(DM, 'Hello?');
    const other = '60144444444@s.whatsapp.net';
    getChats(t.ctx).upsertFromWa({ jid: other, type: 'dm', name: 'Ali' });
    await incoming(other, 'Open today?');
    await settle();
    expect(dm().assignedTo).toBeNull();
    expect(sentTo(DM)).toHaveLength(1);
    expect(getChats(t.ctx).get(other)!.assignedTo).toBe(aiUserId);
    expect(sentTo(other)).toHaveLength(1);
  });

  it('refuses assigning a direct chat to a group-only agent and marks it in the directory', async () => {
    await setUp();
    const admin = await createUserAndLogin(t, { role: 'admin' });
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const assign = (jid: string) =>
      t.app.inject({
        method: 'PATCH',
        url: `/api/chats/${encodeURIComponent(jid)}`,
        headers: authHeaders(admin.cookie),
        payload: { assignedTo: aiUserId },
      });
    const directory = async () =>
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/users/directory',
          headers: authHeaders(agent.cookie),
        })
      )
        .json()
        .users.find((u: DirectoryUser) => u.id === aiUserId) as DirectoryUser;

    expect((await directory()).aiNoDirect).toBeUndefined();
    setAgentDirect(t.ctx, agentId, false, actor);
    expect((await directory()).aiNoDirect).toBe(true);
    const refused = await assign(DM);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('agent_no_direct_chats');
    expect(dm().assignedTo).toBeNull();

    setAgentDirect(t.ctx, agentId, true, actor);
    expect((await assign(DM)).statusCode).toBe(200);
  });

  it('PUT /api/ai/agents/:agentId/direct is for admins and validates its body', async () => {
    await setUp();
    const admin = await createUserAndLogin(t, { role: 'admin' });
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const put = (cookie: string | undefined, payload: object, id = agentId) =>
      t.app.inject({
        method: 'PUT',
        url: `/api/ai/agents/${id}/direct`,
        headers: cookie ? authHeaders(cookie) : { origin: 'http://localhost', host: 'localhost' },
        payload,
      });
    const off = await put(admin.cookie, { enabled: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({ enabled: true, answerDirect: false, directAvailable: true });
    expect(agentById(t.ctx.db, agentId)!.answerDirect).toBe(false);
    expect((await put(admin.cookie, { enabled: 'no' })).statusCode).toBe(400);
    expect((await put(admin.cookie, { enabled: true, x: 1 })).statusCode).toBe(400);
    expect((await put(admin.cookie, { enabled: true }, 999)).statusCode).toBe(404);
    expect((await put(agent.cookie, { enabled: true })).statusCode).toBe(403);
    expect((await put(undefined, { enabled: true })).statusCode).toBe(401);
  });
});

describe('an inbox without groups', () => {
  const ctxWith = (adapter: () => Partial<WaAdapter>) =>
    ({ inboxes: { connections: { adapter } } }) as unknown as AppContext;
  const agent = (over: Partial<AgentRow>) =>
    ({ inboxId: 1, answerDirect: false, ...over }) as AgentRow;

  it('ignores the switch: a Business API agent always answers direct chats', () => {
    const businessApi = ctxWith(() => ({ capabilities: { groups: false } as never }));
    expect(inboxHasGroups(businessApi, 1)).toBe(false);
    expect(answersDirect(businessApi, agent({}))).toBe(true);

    const linkedPhone = ctxWith(() => ({ capabilities: { groups: true } as never }));
    expect(answersDirect(linkedPhone, agent({}))).toBe(false);
    expect(answersDirect(linkedPhone, agent({ answerDirect: true }))).toBe(true);
    // An adapter without its own capabilities is a linked phone.
    expect(
      inboxHasGroups(
        ctxWith(() => ({})),
        1,
      ),
    ).toBe(true);
  });

  it('counts a removed inbox and no inbox as having no groups', () => {
    const removed = ctxWith(() => {
      throw new Error('inbox 2 has no WhatsApp connection');
    });
    expect(inboxHasGroups(removed, 2)).toBe(false);
    expect(inboxHasGroups(removed, null)).toBe(false);
    expect(answersDirect(removed, agent({ inboxId: null }))).toBe(true);
  });

  it('refuses to save the switch of an unknown agent', async () => {
    t = await makeTestApp();
    expect(() => setAgentAnswerDirect(t.ctx.db, 999, false)).toThrow('agent_not_found');
  });
});
