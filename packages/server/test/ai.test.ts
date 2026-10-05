import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AiConnection, AiMemberBody } from '@wa-team-inbox/shared';
import { createAiService, AI_FALLBACK_MS, isResolutionConfirmation } from '../src/ai/service.js';
import type { AiProvider } from '../src/ai/provider-types.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';
import { sha256 } from '../src/crypto/secret.js';
import { createMessageService } from '../src/messages/service.js';
import { pdfFixture } from './ai-fixtures.js';
import { OAuthError } from '../src/ai/chatgpt-oauth.js';

let t: TestApp;
let provider: AiProvider;
let actor: { userId: number; ip: null };
let cookie: string;
const jid = 'customer@s.whatsapp.net';
const body: AiMemberBody = {
  displayName: 'Sales Agent',
  enabled: true,
  instructions: 'Be concise',
  context: 'Opening hours: 9am to 5pm. Delivery costs RM10.',
};
beforeEach(async () => {
  t = await makeTestApp();
  const auth = t.ctx.services.auth!;
  const admin = auth.createUser({
    username: 'admin',
    displayName: 'Admin',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  actor = { userId: admin.id, ip: null };
  cookie = `sid=${auth.createSession(admin.id, { ip: '127.0.0.1', userAgent: 'test' })}`;
  await t.ctx.services.ai!.shutdown();
  t.ctx.services.messages!.shutdown();
  t.ctx.services.messages = createMessageService(t.ctx, {
    now: () => Date.now(),
    queue: { spacingMs: 0 },
  });
  provider = {
    generate: vi.fn().mockResolvedValue({
      reply: 'We open at 9am. Has this answered your question?',
      action: 'ask_resolution',
    }),
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(),
  };
  t.ctx.services.ai = createAiService(t.ctx, { provider, isOnline: (id) => id % 2 === 0 });
  t.ctx.services.ai.saveConnection({ mode: 'api', model: '', apiKey: 'test-api-key-123' }, actor);
  t.ctx.services.ai.saveMember(body, actor);
});
afterEach(async () => {
  await t.close();
  vi.useRealTimers();
});
async function incoming(
  id = 'incoming',
  text = 'What are your opening hours?',
  source: 'live' | 'history' = 'live',
  chatJid = jid,
  fromMe = false,
) {
  return getMessages(t.ctx).ingest(
    {
      id,
      chatJid,
      body: text,
      type: 'text',
      fromMe,
      senderJid: chatJid,
      senderName: 'Customer',
      timestamp: Date.now(),
      quotedId: null,
      media: null,
    },
    source,
  );
}
function human(username: string) {
  return t.ctx.services.auth!.createUser({
    username,
    displayName: username,
    role: 'agent',
    password: 'password123',
    mustChangePassword: false,
  });
}
function clock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}

it('claims an unassigned live direct chat after ten seconds, answers with only its conversation and business knowledge, and replies promptly thereafter', async () => {
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS - 1);
  expect(provider.generate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  const ai = t.ctx.services.ai!.status().member!;
  expect(getChats(t.ctx).get(jid)?.assignedTo).toBe(ai.id);
  expect(t.wa.sent[0]?.text).toContain('9am');
  const prompt = vi.mocked(provider.generate).mock.calls[0]![2];
  expect(prompt.input).toContain('Opening hours');
  expect(prompt.input).not.toContain('test-api-key');
  expect(prompt.instructions).toContain('Sales Agent');
  await incoming('next', 'What is delivery?');
  await vi.advanceTimersByTimeAsync(1200);
  expect(provider.generate).toHaveBeenCalledTimes(2);
  expect(t.wa.sent).toHaveLength(2);
});

it('batches customer messages and ignores imported history, groups, and chats already assigned to a human', async () => {
  clock();
  await incoming('history', 'Old question', 'history', 'old@s.whatsapp.net');
  await incoming('group', 'Question', 'live', 'team@g.us');
  const user = human('human');
  getChats(t.ctx).upsertFromWa({ jid: 'owned@s.whatsapp.net', type: 'dm', name: 'Owned' });
  getChats(t.ctx).patch('owned@s.whatsapp.net', { assignedTo: user.id }, actor.userId);
  await incoming('owned', 'Question', 'live', 'owned@s.whatsapp.net');
  await incoming();
  await vi.advanceTimersByTimeAsync(5000);
  await incoming('second', 'And delivery?');
  await vi.advanceTimersByTimeAsync(9999);
  expect(provider.generate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  expect(t.wa.sent).toHaveLength(1);
  expect(vi.mocked(provider.generate).mock.calls[0]![2].input).toContain('And delivery?');
});

it('cancels fallback after a human or linked-phone reply', async () => {
  clock();
  await incoming();
  getMessages(t.ctx).sendText(
    jid,
    { text: 'I can help', clientId: 'human-reply' },
    human('human').id,
  );
  await incoming('phone-in', 'Hello', 'live', 'phone@s.whatsapp.net');
  await incoming('phone-out', 'I can help', 'live', 'phone@s.whatsapp.net', true);
  await vi.advanceTimersByTimeAsync(12_000);
  expect(provider.generate).not.toHaveBeenCalled();
});

it('aborts generation on human takeover and ignores a late provider result', async () => {
  const taker = human('takeover');
  let finish!: (value: { reply: string; action: 'answer' }) => void;
  vi.mocked(provider.generate).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(10_000);
  const signal = vi.mocked(provider.generate).mock.calls[0]![3];
  getChats(t.ctx).patch(jid, { assignedTo: taker.id }, taker.id);
  expect(signal.aborted).toBe(true);
  finish({ reply: 'Late answer', action: 'answer' });
  await vi.advanceTimersByTimeAsync(0);
  expect(t.wa.sent).toHaveLength(0);
  await incoming('later');
  await vi.advanceTimersByTimeAsync(12_000);
  expect(provider.generate).toHaveBeenCalledTimes(1);
});

it('cancels a queued reply while presence is pending before WhatsApp sends', async () => {
  const user = human('takeover');
  let finishPresence!: () => void;
  vi.spyOn(t.wa, 'sendPresence').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishPresence = resolve;
      }),
  );
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(10_000);
  getChats(t.ctx).patch(jid, { assignedTo: user.id }, user.id);
  finishPresence();
  await vi.advanceTimersByTimeAsync(0);
  expect(t.wa.sent).toHaveLength(0);
  expect(t.ctx.db.prepare('SELECT status FROM messages WHERE from_me = 1').get()).toEqual({
    status: 'failed',
  });
});

it('cancels an older answer as soon as live media arrives and never lets delayed downloads supersede newer text', async () => {
  let finishOld!: (value: { reply: string; action: 'answer' }) => void;
  vi.mocked(provider.generate).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(10_000);
  let download!: (buffer: Buffer) => void;
  const image = getMessages(t.ctx).ingest(
    {
      id: 'new-image',
      chatJid: jid,
      body: null,
      type: 'image',
      fromMe: false,
      senderJid: jid,
      senderName: 'Customer',
      timestamp: Date.now(),
      quotedId: null,
      media: {
        mime: 'image/png',
        fileName: 'photo.png',
        download: () =>
          new Promise((resolve) => {
            download = resolve;
          }),
      },
    },
    'live',
  );
  expect(vi.mocked(provider.generate).mock.calls[0]![3].aborted).toBe(true);
  await incoming('newer-text', 'What are your delivery costs?');
  finishOld({ reply: 'Outdated answer', action: 'answer' });
  download(Buffer.from('fake-image'));
  await image;
  await vi.advanceTimersByTimeAsync(1200);
  expect(provider.generate).toHaveBeenCalledTimes(2);
  expect(t.wa.sent).toHaveLength(1);
  expect(t.wa.sent[0]?.text).not.toBe('Outdated answer');
  expect(
    t.ctx.db
      .prepare('SELECT last_customer_message_id FROM ai_chat_state WHERE chat_jid = ?')
      .get(jid),
  ).toEqual({ last_customer_message_id: 'newer-text' });
});

it('restores only live pending work when ChatGPT becomes connected after startup', async () => {
  await incoming();
  await t.ctx.services.ai!.shutdown();
  t.ctx.settings.set('ai_inbox_provider', { mode: 'chatgpt', model: '' });
  let connected = false;
  provider.connection = () => ({
    state: connected ? 'connected' : 'signed_out',
    loginUrl: null,
    error: null,
  });
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  t.ctx.services.ai = createAiService(t.ctx, { provider });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(provider.generate).not.toHaveBeenCalled();
  connected = true;
  await vi.advanceTimersByTimeAsync(1300);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  expect(t.wa.sent).toHaveLength(1);
});

it('correlates an early echo of its own reply without pausing AI or losing the confirmation state', async () => {
  let finishSend!: (value: { id: string; timestamp: number }) => void;
  vi.spyOn(t.wa, 'sendText').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSend = resolve;
      }),
  );
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(10_000);
  const echo = incoming(
    'ai-echo',
    'We open at 9am. Has this answered your question?',
    'live',
    jid,
    true,
  );
  finishSend({ id: 'ai-echo', timestamp: Date.now() });
  await echo;
  await vi.advanceTimersByTimeAsync(0);
  expect(
    t.ctx.db
      .prepare(
        'SELECT paused, awaiting_confirmation, last_replied_message_id FROM ai_chat_state WHERE chat_jid = ?',
      )
      .get(jid),
  ).toEqual({ paused: 0, awaiting_confirmation: 1, last_replied_message_id: 'incoming' });
  expect(
    t.ctx.db.prepare("SELECT sent_by_user_id FROM messages WHERE id = 'ai-echo'").get(),
  ).toEqual({ sent_by_user_id: t.ctx.services.ai!.status().member!.id });
});

it('drains a persisted live chat that exceeded the initial timer capacity', async () => {
  await t.ctx.services.ai!.shutdown();
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  t.ctx.services.ai = createAiService(t.ctx, { provider });
  for (let i = 0; i < 201; i++)
    await incoming(`burst-${i}`, 'Opening hours?', 'live', `burst-${i}@s.whatsapp.net`);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(provider.generate).toHaveBeenCalledTimes(201);
  expect(t.wa.sent).toHaveLength(201);
});

it('hands off to an enabled online human with zero open chats, then pauses AI fallback', async () => {
  const idle = human('idle'); // admin=1,AI=2,idle=3 => offline by test predicate
  const online = human('online'); // id=4 online
  const busy = human('busy');
  getChats(t.ctx).upsertFromWa({ jid: 'busy@s.whatsapp.net', type: 'dm', name: 'Busy' });
  getChats(t.ctx).patch('busy@s.whatsapp.net', { assignedTo: busy.id }, actor.userId);
  vi.mocked(provider.generate).mockResolvedValue({
    reply: 'A human will help you.',
    action: 'handoff',
  });
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(getChats(t.ctx).get(jid)?.assignedTo).toBe(online.id);
  expect(getChats(t.ctx).get(jid)?.assignedTo).not.toBe(idle.id);
  await incoming('followup');
  await vi.advanceTimersByTimeAsync(11_000);
  expect(provider.generate).toHaveBeenCalledTimes(1);
});

it('returns an unanswered chat to unassigned if no human is available and never reclaims the handoff', async () => {
  vi.mocked(provider.generate).mockRejectedValue(new Error('API credential content must not leak'));
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(t.wa.sent[0]?.text).toContain('human agent');
  expect(getChats(t.ctx).get(jid)?.assignedTo).toBeNull();
  await incoming('followup');
  await vi.advanceTimersByTimeAsync(15_000);
  expect(provider.generate).toHaveBeenCalledTimes(1);
});

it('requires an actual customer confirmation after asking before resolving, releases AI, and allows future incoming messages to reopen', async () => {
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(10_000);
  vi.mocked(provider.generate).mockResolvedValue({ reply: 'Thank you!', action: 'resolve' });
  await incoming('not-done', 'No, please do not resolve it');
  await vi.advanceTimersByTimeAsync(1200);
  expect(getChats(t.ctx).get(jid)?.status).toBe('open');
  await incoming('confirmation', 'Yes, thank you!');
  await vi.advanceTimersByTimeAsync(1200);
  expect(getChats(t.ctx).get(jid)).toMatchObject({ status: 'resolved', assignedTo: null });
  await incoming('reopened', 'Another question');
  expect(getChats(t.ctx).get(jid)?.status).toBe('open');
  await vi.advanceTimersByTimeAsync(10_000);
  // A fresh conversation has no prior resolution question.
  expect(getChats(t.ctx).get(jid)?.status).toBe('open');
});

it('lets a human resolve an AI-owned chat and stops further pending AI work', async () => {
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(10_000);
  await incoming('pending');
  getChats(t.ctx).patch(jid, { status: 'resolved' }, actor.userId);
  await vi.advanceTimersByTimeAsync(1000);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  expect(getChats(t.ctx).get(jid)).toMatchObject({ status: 'resolved', assignedTo: null });
});

it('keeps AI identity out of authentication, password reset and admin permissions, including forged legacy sessions', async () => {
  const ai = t.ctx.services.ai!.status().member!;
  expect(() =>
    t.ctx.services.auth!.createSession(ai.id, { ip: 'test', userAgent: 'test' }),
  ).toThrow();
  t.ctx.db
    .prepare('INSERT INTO sessions(token_hash,user_id,created_at,last_seen_at) VALUES (?, ?, ?, ?)')
    .run(sha256('forged'), ai.id, Date.now(), Date.now());
  expect(t.ctx.services.auth!.resolveSession('forged')).toBeNull();
  expect(
    (
      await t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: ai.username, password: '' },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await t.app.inject({
        method: 'POST',
        url: `/api/users/${ai.id}/reset-password`,
        headers: authHeaders(cookie),
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await t.app.inject({
        method: 'PATCH',
        url: `/api/users/${ai.id}`,
        headers: authHeaders(cookie),
        payload: { role: 'admin' },
      })
    ).statusCode,
  ).toBe(400);
  expect(isResolutionConfirmation('Yes, thank you!')).toBe(true);
  expect(isResolutionConfirmation('yes but it is still broken')).toBe(false);
});

it('restricts AI settings to admins, separates global/member changes, never returns credentials, and exposes only safe directory fields', async () => {
  const agent = human('agent');
  const agentCookie = `sid=${t.ctx.services.auth!.createSession(agent.id, { ip: 'test', userAgent: 'test' })}`;
  expect((await t.app.inject({ url: '/api/ai' })).statusCode).toBe(401);
  expect(
    (await t.app.inject({ url: '/api/ai', headers: { cookie: agentCookie } })).statusCode,
  ).toBe(403);
  const key = 'replacement-secret-api-key';
  const saved = await t.app.inject({
    method: 'PATCH',
    url: '/api/ai/connection',
    headers: authHeaders(cookie),
    payload: { mode: 'api', model: 'gpt-4.1-mini', apiKey: key },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.body).not.toContain(key);
  expect(saved.json().hasApiKey).toBe(true);
  expect(t.ctx.db.prepare("SELECT value FROM settings WHERE key = 'ai_api_key'").get()).not.toEqual(
    { value: key },
  );
  const memberSaved = await t.app.inject({
    method: 'PUT',
    url: '/api/ai',
    headers: authHeaders(cookie),
    payload: { ...body, displayName: 'New name', mode: 'chatgpt', model: 'wrong' },
  });
  expect(memberSaved.statusCode).toBe(200);
  expect(memberSaved.json().settings).toMatchObject({
    mode: 'api',
    model: 'gpt-4.1-mini',
    displayName: 'New name',
  });
  const directory = await t.app.inject({
    url: '/api/users/directory',
    headers: { cookie: agentCookie },
  });
  expect(directory.statusCode).toBe(200);
  expect(
    directory.json().users.find((user: { kind?: string }) => user.kind === 'ai'),
  ).toMatchObject({ aiRole: 'sales', displayName: 'New name' });
  expect(directory.body).not.toContain('username');
  expect(directory.body).not.toContain(key);
});

it('rejects an incompatible ChatGPT connection before changing saved settings, credentials or chat ownership', async () => {
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  const before = t.ctx.services.ai!.status();
  const key = t.ctx.settings.getSecret('ai_api_key');
  const invalid = { mode: 'chatgpt' as const, model: 'gpt-4.1-mini', apiKey: 'new-test-api-key' };
  const response = await t.app.inject({
    method: 'PATCH',
    url: '/api/ai/connection',
    headers: authHeaders(cookie),
    payload: invalid,
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().error.message).toContain('ChatGPT mode supports');
  expect(() => t.ctx.services.ai!.saveConnection(invalid, actor)).toThrow('ChatGPT mode supports');
  expect(t.ctx.services.ai!.status().settings).toEqual(before.settings);
  expect(t.ctx.settings.getSecret('ai_api_key')).toBe(key);
  expect(getChats(t.ctx).get(jid)?.assignedTo).toBe(before.member!.id);
});

it.each(['', 'gpt-6-sol', 'gpt-5.5'])(
  'accepts a listed ChatGPT model %s (experimental direct sign-in list)',
  async (model) => {
    const response = await t.app.inject({
      method: 'PATCH',
      url: '/api/ai/connection',
      headers: authHeaders(cookie),
      payload: { mode: 'chatgpt', model },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().settings).toMatchObject({ mode: 'chatgpt', model });
  },
);

it('keeps custom model names available in API mode', async () => {
  const response = await t.app.inject({
    method: 'PATCH',
    url: '/api/ai/connection',
    headers: authHeaders(cookie),
    payload: { mode: 'api', model: 'custom-api-model' },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().settings.model).toBe('custom-api-model');
});

it('extracts authenticated document uploads, removes them, and audits metadata without content', async () => {
  const boundary = 'ai-business-document';
  const data = pdfFixture('Delivery costs RM10');
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="../delivery.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const result = await t.app.inject({
    method: 'POST',
    url: '/api/ai/documents',
    headers: {
      ...authHeaders(cookie),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().documents[0]).toMatchObject({ name: 'delivery.pdf', size: data.length });
  const document = t.ctx.db.prepare('SELECT text FROM ai_documents').get() as { text: string };
  expect(document.text).toContain('RM10');
  const audit = t.ctx.db
    .prepare("SELECT meta FROM audit_log WHERE action = 'ai.document_add'")
    .get() as { meta: string };
  expect(audit.meta).not.toContain('RM10');
  expect(
    (
      await t.app.inject({
        method: 'DELETE',
        url: `/api/ai/documents/${result.json().documents[0].id}`,
        headers: authHeaders(cookie),
      })
    ).statusCode,
  ).toBe(200);
  expect(t.ctx.services.ai!.status().documents).toHaveLength(0);
});

it('disables AI and releases its active chats immediately', async () => {
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(10_000);
  await incoming('pending');
  const ai = t.ctx.services.ai!.status().member!;
  t.ctx.services.auth!.updateUser(ai.id, { disabled: true }, actor.userId);
  await vi.advanceTimersByTimeAsync(1000);
  expect(getChats(t.ctx).get(jid)?.assignedTo).toBeNull();
  expect(provider.generate).toHaveBeenCalledTimes(1);
  expect(t.ctx.services.ai!.status().settings.enabled).toBe(false);
});

it('stops claiming chats and releases its own without messaging customers when the ChatGPT connection breaks', async () => {
  await t.ctx.services.ai!.shutdown();
  t.ctx.settings.set('ai_inbox_provider', { mode: 'chatgpt', model: '' });
  let state: AiConnection['state'] = 'connected';
  provider.connection = () => ({
    state,
    loginUrl: null,
    error: state === 'error' ? 'ChatGPT stopped accepting this connection.' : null,
  });
  vi.mocked(provider.generate).mockImplementation(async () => {
    state = 'error';
    throw new Error('ChatGPT stopped accepting this connection.');
  });
  human('online-agent');
  clock();
  t.ctx.services.ai = createAiService(t.ctx, { provider, isOnline: () => true });
  await incoming();
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  expect(t.wa.sent).toHaveLength(0);
  expect(getChats(t.ctx).get(jid)?.assignedTo).toBeNull();
  await incoming('second', 'Hello?', 'live', 'other@s.whatsapp.net');
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS + 1000);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  expect(getChats(t.ctx).get('other@s.whatsapp.net')?.assignedTo).toBeNull();
  expect(t.wa.sent).toHaveLength(0);
});

it('passes through only known sign-in messages when pasting a sign-in address', async () => {
  const failWith = (error: Error) => {
    provider.submitCallbackUrl = vi.fn().mockRejectedValue(error);
    return t.ctx.services.ai!.completeSignIn('http://localhost:1455/auth/callback?code=c&state=s');
  };
  await expect(failWith(new OAuthError('Start sign-in again.'))).rejects.toThrow(
    'Start sign-in again.',
  );
  const leaky = failWith(new Error('boom at /home/user/secret?token=abc'));
  await expect(leaky).rejects.toThrow('ChatGPT sign-in failed. Try again.');
  await expect(leaky).rejects.not.toThrow(/secret/);
});

it('releases its own chats without messaging customers when the connection breaks outside an answer', async () => {
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  const ai = t.ctx.services.ai!.status().member!;
  expect(getChats(t.ctx).get(jid)?.assignedTo).toBe(ai.id);
  const sent = t.wa.sent.length;
  await t.ctx.services.ai!.shutdown();
  let broke!: () => void;
  provider.onProblem = (listener) => (broke = listener);
  provider.connection = () => ({ state: 'error', loginUrl: null, error: 'blocked' });
  t.ctx.services.ai = createAiService(t.ctx, { provider, isOnline: () => true });
  broke();
  expect(getChats(t.ctx).get(jid)?.assignedTo).toBeNull();
  expect(t.wa.sent).toHaveLength(sent);
});

const count = (table: string) =>
  (t.ctx.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

it('answers Try it from draft knowledge without touching chats, messages, audit or WhatsApp', async () => {
  vi.mocked(provider.generate).mockResolvedValue({ reply: 'Delivery is RM10.', action: 'answer' });
  const before = ['chats', 'messages', 'ai_chat_state', 'audit_log'].map(count);
  const result = await t.ctx.services.ai!.tryAnswer({
    question: 'How much is delivery?',
    knowledge: {
      displayName: 'Draft Agent',
      instructions: 'Be brief',
      context: 'Delivery costs RM10.\n\nQ: Open on Sunday?\nA: No',
    },
  });
  expect(result).toEqual({
    ok: true,
    reply: 'Delivery is RM10.',
    action: 'answer',
    model: 'gpt-4.1-mini',
    error: null,
  });
  const [, key, prompt] = vi.mocked(provider.generate).mock.calls[0]!;
  expect(prompt.instructions).toContain('named Draft Agent');
  expect(prompt.instructions).toContain('Be brief');
  expect(prompt.input).toContain('Delivery costs RM10.');
  expect(prompt.input).not.toContain('Opening hours');
  expect(key).toBe('test-api-key-123');
  expect(['chats', 'messages', 'ai_chat_state', 'audit_log'].map(count)).toEqual(before);
  expect(t.wa.sent).toHaveLength(0);
  expect(t.ctx.services.ai!.status().settings.context).toBe(body.context);
});

it('Try it reports a missing connection and a provider failure without throwing', async () => {
  await t.ctx.services.ai!.shutdown();
  t.ctx.settings.set('ai_inbox_provider', { mode: 'chatgpt', model: '' });
  provider.connection = () => ({ state: 'signed_out', loginUrl: null, error: null });
  t.ctx.services.ai = createAiService(t.ctx, { provider });
  const draft = { displayName: 'A', instructions: '', context: 'Delivery RM10' };
  expect(await t.ctx.services.ai.tryAnswer({ question: 'Delivery?', knowledge: draft })).toEqual({
    ok: false,
    reply: null,
    action: null,
    model: null,
    error: 'Set up the AI connection in Settings → AI first.',
  });
  expect(provider.generate).not.toHaveBeenCalled();
  provider.connection = () => ({ state: 'connected', loginUrl: null, error: null });
  provider.resolveModel = vi.fn(async () => 'gpt-6.1-sol');
  vi.mocked(provider.generate).mockRejectedValue(new Error('ChatGPT usage limit reached.'));
  expect(await t.ctx.services.ai.tryAnswer({ question: 'Delivery?', knowledge: draft })).toEqual({
    ok: false,
    reply: null,
    action: null,
    model: 'gpt-6.1-sol',
    error: 'ChatGPT usage limit reached.',
  });
});

it('refuses to turn on the AI member without any knowledge', () => {
  const empty = { ...body, instructions: '', context: '' };
  expect(() => t.ctx.services.ai!.saveMember(empty, actor)).toThrow(
    'Add instructions, business context or a document',
  );
  expect(t.ctx.services.ai!.saveMember({ ...empty, enabled: false }, actor).settings.enabled).toBe(
    false,
  );
});

it('turns on with Business context only', () => {
  const status = t.ctx.services.ai!.saveMember(
    { ...body, instructions: '', context: 'Delivery RM10' },
    actor,
  );
  expect(status.settings).toMatchObject({ enabled: true, context: 'Delivery RM10' });
});

it('loads stored notes and FAQs as Business context and saves only the new shape', () => {
  t.ctx.settings.set('ai_sales_member', {
    displayName: 'Sales Agent',
    instructions: 'Be kind',
    notes: 'Open 9am to 5pm.',
    faqs: [{ question: 'Open on Sunday?', answer: 'No' }],
  });
  const migrated = 'Open 9am to 5pm.\n\nQ: Open on Sunday?\nA: No';
  const settings = t.ctx.services.ai!.status().settings;
  expect(settings).toMatchObject({ instructions: 'Be kind', context: migrated });
  expect(settings).not.toHaveProperty('notes');
  expect(settings).not.toHaveProperty('faqs');
  t.ctx.services.ai!.saveMember(
    {
      displayName: settings.displayName,
      enabled: settings.enabled,
      instructions: settings.instructions,
      context: settings.context,
    },
    actor,
  );
  expect(t.ctx.settings.get('ai_sales_member', {})).toEqual({
    displayName: 'Sales Agent',
    instructions: 'Be kind',
    context: migrated,
  });
});

it('sends the Business context to live replies as a named knowledge source', async () => {
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  const { input } = vi.mocked(provider.generate).mock.calls[0]![2];
  expect(JSON.parse(input).businessKnowledge).toBe(
    '[Business context]\nOpening hours: 9am to 5pm. Delivery costs RM10.',
  );
});

it('tells the AI to answer an order question with known facts and keeps the chat', async () => {
  clock();
  await incoming('order', 'Can I get delivery tomorrow at 3pm? How much in total?');
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  const { instructions } = vi.mocked(provider.generate).mock.calls[0]![2];
  expect(instructions).toContain('say the team will confirm the slot or order');
  expect(getChats(t.ctx).get(jid)?.assignedTo).toBe(t.ctx.services.ai!.status().member!.id);
});

it('resolves once when the customer confirms in free text', async () => {
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  vi.mocked(provider.generate).mockResolvedValue({ reply: 'Glad to help!', action: 'resolve' });
  await incoming('confirm', 'Ok noted, yes that answers it. Thank you!');
  await vi.advanceTimersByTimeAsync(1200);
  expect(getChats(t.ctx).get(jid)).toMatchObject({ status: 'resolved', assignedTo: null });
  expect(t.wa.sent.map((message) => message.text)).toEqual([
    'We open at 9am. Has this answered your question?',
    'Glad to help!',
  ]);
});

it('resolves after two resolution questions answered with confirming-looking replies', async () => {
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  // The model keeps asking; the server stops the loop.
  await incoming('first-ok', 'ok thanks');
  await vi.advanceTimersByTimeAsync(1200);
  expect(getChats(t.ctx).get(jid)?.status).toBe('open');
  await incoming('second-ok', 'ok thanks');
  await vi.advanceTimersByTimeAsync(1200);
  expect(getChats(t.ctx).get(jid)).toMatchObject({ status: 'resolved', assignedTo: null });
  expect(t.wa.sent).toHaveLength(3);
});

it('Try it applies the resolution gate and never resolves or assigns anything', async () => {
  vi.mocked(provider.generate).mockResolvedValue({ reply: 'Bye!', action: 'resolve' });
  const result = await t.ctx.services.ai!.tryAnswer({
    question: 'Thanks!',
    knowledge: { displayName: 'A', instructions: '', context: 'Delivery RM10' },
  });
  expect(result).toMatchObject({ ok: true, action: 'ask_resolution' });
  expect(t.ctx.db.prepare('SELECT count(*) AS n FROM chats').get()).toEqual({ n: 0 });
});

it('never turns a model answer into a resolution, even after two resolution questions', async () => {
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  await incoming('first-ok', 'ok thanks');
  await vi.advanceTimersByTimeAsync(1200);
  vi.mocked(provider.generate).mockResolvedValue({ reply: '3 boxes are RM30.', action: 'answer' });
  await incoming('order', "Ok great, I'll take 3 boxes");
  await vi.advanceTimersByTimeAsync(1200);
  expect(getChats(t.ctx).get(jid)?.status).toBe('open');
  expect(t.wa.sent.at(-1)?.text).toBe('3 boxes are RM30.');
});

it('restarts the resolution count after the customer asks something new', async () => {
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  await incoming('new-question', 'And how much is delivery?');
  await vi.advanceTimersByTimeAsync(1200);
  await incoming('ok', 'ok thanks');
  await vi.advanceTimersByTimeAsync(1200);
  expect(getChats(t.ctx).get(jid)?.status).toBe('open');
  expect(t.wa.sent).toHaveLength(3);
});

it('checks every customer message in a debounce batch before resolving', async () => {
  clock();
  await incoming();
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  vi.mocked(provider.generate).mockResolvedValue({ reply: 'Glad to help!', action: 'resolve' });
  await incoming('objection', 'No, still not working');
  await incoming('thanks', 'thanks');
  await vi.advanceTimersByTimeAsync(1200);
  expect(getChats(t.ctx).get(jid)?.status).toBe('open');
  expect(t.wa.sent).toHaveLength(2);
  expect(t.wa.sent.at(-1)?.text).toBe('Does that answer your question?');
});
