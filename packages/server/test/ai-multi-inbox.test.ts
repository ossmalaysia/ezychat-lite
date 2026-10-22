// The AI with several inboxes: each inbox is answered by its own AI agent; a hand-off picks only a
// teammate who may open the chat's inbox (RF-3). Plan: multi-inbox Task 5, custom agents Task 4.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AiMemberBody } from '@ezychat/shared';
import { createAiService, AI_FALLBACK_MS } from '../src/ai/service.js';
import type { AiProvider } from '../src/ai/provider-types.js';
import { createMessageService } from '../src/messages/service.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { makeTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let provider: AiProvider;
const C = '60123456789@s.whatsapp.net';
const body: AiMemberBody = {
  displayName: 'Sales Agent',
  enabled: true,
  instructions: 'Be concise',
};

beforeEach(async () => {
  t = await makeTestApp({ maxInboxes: 3, inboxes: 2 });
  const auth = t.ctx.services.auth!;
  const admin = auth.createUser({
    username: 'admin',
    displayName: 'Admin',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  const actor = { userId: admin.id, ip: null };
  await t.ctx.services.ai!.shutdown();
  t.ctx.services.messages!.shutdown();
  t.ctx.services.messages = createMessageService(t.ctx, {
    now: () => Date.now(),
    queue: { spacingMs: 0 },
  });
  provider = {
    generate: vi.fn().mockResolvedValue({ reply: 'A teammate will help.', action: 'handoff' }),
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(),
  };
  t.ctx.services.ai = createAiService(t.ctx, { provider, isOnline: () => true });
  t.ctx.services.ai.saveConnection({ mode: 'api', model: '', apiKey: 'test-api-key-123' }, actor);
  t.ctx.services.ai.saveMember({ ...body, enabled: false }, actor);
  t.ctx.services.ai.addText(null, { name: 'Business context', text: 'Open 9 to 5.' }, actor);
  t.ctx.services.ai.saveMember(body, actor);
  // Inbox 2 has its own agent (custom agents: one agent per inbox).
  const second = t.ctx.services.ai.createAgent({ ...body, enabled: false, inboxId: 2 }, actor);
  t.ctx.services.ai.addText(
    second.agent.id,
    { name: 'Business context', text: 'Open 9 to 5.' },
    actor,
  );
  t.ctx.services.ai.saveAgent(second.agent.id, { ...body, inboxId: 2 }, actor);
});
afterEach(async () => {
  await t.close();
  vi.useRealTimers();
});

function agent(username: string, inboxIds: number[]) {
  const user = t.ctx.services.auth!.createUser({
    username,
    displayName: username,
    role: 'agent',
    password: 'password123',
    mustChangePassword: false,
  });
  t.ctx.inboxes.repo.setUserInboxes(user.id, inboxIds);
  return user;
}

async function incoming(inboxId: number, id: string) {
  return getMessages(t.ctx).ingest(
    {
      id,
      chatJid: C,
      body: 'Can a person call me?',
      type: 'text',
      fromMe: false,
      senderJid: C,
      senderName: 'Customer',
      timestamp: Date.now(),
      quotedId: null,
      media: null,
    },
    'live',
    inboxId,
  );
}

it('hands an inbox 2 chat only to a teammate of inbox 2, never to one with inbox 1 only', async () => {
  const one = agent('one', [1]); // lower id: picked first without the inbox check
  const two = agent('two', [2]);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  await incoming(2, 'in-2');
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  const chat = getChats(t.ctx).get(`${C}#2`)!;
  expect(chat.assignedTo).toBe(two.id);
  expect(chat.assignedTo).not.toBe(one.id);
  // the AI answered from inbox 2's own number
  expect(t.inboxWa(2).sent.map((s) => s.text)).toContain('A teammate will help.');
  expect(t.inboxWa(1).sent).toHaveLength(0);
});

it('leaves an inbox 2 chat unassigned when only inbox 1 teammates are free', async () => {
  agent('one', [1]);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  await incoming(2, 'in-2');
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  expect(getChats(t.ctx).get(`${C}#2`)!.assignedTo).toBeNull();
});

it('still hands an inbox 1 chat to the inbox 1 teammate', async () => {
  const one = agent('one', [1]);
  agent('two', [2]);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  await incoming(1, 'in-1');
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  expect(getChats(t.ctx).get(C)!.assignedTo).toBe(one.id);
});
