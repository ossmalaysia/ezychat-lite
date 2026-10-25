// The reply window and message templates of a Business API-like inbox (implementation.md, Lite
// server 6–9), on the dev `fake-api` type: free-form sends stop when the window closes, templates
// still go out, the AI hands over with `window_closed`, MCP refuses.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MessageListResponse,
  TemplateListResponse,
  type Message,
  type User,
} from '@ezychat/shared';
import type { FakeWaAdapter } from '@ezychat/wa';
import type { ApiPrincipal } from '../src/api-tokens/index.js';
import { AI_FALLBACK_MS, createAiService } from '../src/ai/service.js';
import type { AiProvider } from '../src/ai/provider-types.js';
import { FAKE_API_TYPE } from '../src/inboxes/fake-api.js';
import { replyWindowOpen } from '../src/inboxes/reply-window.js';
import { getInboxService } from '../src/inboxes/service.js';
import { createInboxSendPort, SendError } from '../src/mcp/send.js';
import { fillTemplate, templateVariables } from '../src/messages/templates.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

const enc = encodeURIComponent;
const C = '60123456789@s.whatsapp.net';
const KEY = `${C}#2`;
const HOUR = 3_600_000;

let t: TestApp;
let admin: { cookie: string; user: User };
let api: FakeWaAdapter;

beforeEach(async () => {
  t = await makeTestApp({ maxInboxes: 2 });
  admin = await createUserAndLogin(t, { role: 'admin' });
  await getInboxService(t.ctx).create(
    { name: 'Business API', memberIds: [] },
    { userId: admin.user.id, ip: null },
    { type: FAKE_API_TYPE },
  );
  api = t.inboxWa(2);
});
afterEach(async () => {
  await t.close();
  vi.useRealTimers();
});

async function inbound(
  inboxId: number,
  id: string,
  opts: { timestamp?: number; source?: 'live' | 'history'; fromMe?: boolean } = {},
) {
  return getMessages(t.ctx).ingest(
    {
      id,
      chatJid: C,
      chatJidAlt: null,
      senderJid: C,
      senderJidAlt: null,
      senderName: 'Aminah',
      fromMe: opts.fromMe ?? false,
      type: 'text',
      body: `hello ${id}`,
      quotedId: null,
      timestamp: opts.timestamp ?? Date.now(),
      media: null,
    },
    opts.source ?? 'live',
    inboxId,
  );
}

const lastInbound = (key = KEY) => getChats(t.ctx).get(key)?.lastInboundAt ?? null;
const setLastInbound = (at: number, key = KEY) =>
  t.ctx.db.prepare('UPDATE chats SET last_inbound_at = ? WHERE jid = ?').run(at, key);
const closeWindow = (key = KEY) => setLastInbound(Date.now() - 25 * HOUR, key);

const sendText = (key: string, clientId: string, cookie = admin.cookie) =>
  t.app.inject({
    method: 'POST',
    url: `/api/chats/${enc(key)}/messages`,
    headers: authHeaders(cookie),
    payload: { text: 'Hello', clientId },
  });

function upload(key: string, fields: Record<string, string>, data: Buffer, name: string) {
  const boundary = '----rw' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = Object.entries(fields).map(([k, v]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
  );
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return t.app.inject({
    method: 'POST',
    url: `/api/chats/${enc(key)}/media`,
    headers: {
      ...authHeaders(admin.cookie),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat(parts),
  });
}

const sendTemplate = (key: string, payload: Record<string, unknown>) =>
  t.app.inject({
    method: 'POST',
    url: `/api/chats/${enc(key)}/template`,
    headers: authHeaders(admin.cookie),
    payload,
  });

const listTemplates = (inboxId: number, query = '', cookie = admin.cookie) =>
  t.app.inject({
    method: 'GET',
    url: `/api/inboxes/${inboxId}/templates${query}`,
    headers: authHeaders(cookie),
  });

async function messages(key = KEY): Promise<Message[]> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/chats/${enc(key)}/messages`,
    headers: authHeaders(admin.cookie),
  });
  return MessageListResponse.parse(res.json()).messages;
}

const row = (clientId: string) =>
  t.ctx.db.prepare('SELECT id, status, error FROM messages WHERE client_id = ?').get(clientId) as
    { id: string; status: string; error: string | null } | undefined;

async function waitFor(fn: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('last customer message', () => {
  it('is set by live inbound messages only, never by history or our own messages', async () => {
    const at = Date.now() - 2 * HOUR;
    await inbound(2, 'live-1', { timestamp: at });
    expect(lastInbound()).toBe(at);
    await inbound(2, 'hist-1', { timestamp: Date.now(), source: 'history' });
    await inbound(2, 'mine-1', { timestamp: Date.now(), fromMe: true });
    expect(lastInbound()).toBe(at);
    // an older live message (late delivery) never moves it back
    await inbound(2, 'late-1', { timestamp: at - HOUR });
    expect(lastInbound()).toBe(at);
    const chats = await t.app.inject({
      method: 'GET',
      url: '/api/chats',
      headers: authHeaders(admin.cookie),
    });
    expect(
      (chats.json().chats as Array<{ jid: string; lastInboundAt: number | null }>).find(
        (c) => c.jid === KEY,
      )?.lastInboundAt,
    ).toBe(at);
  });

  it('replyWindowOpen: no window for a linked phone, else the last message + hours', async () => {
    await inbound(1, 'phone-1', { timestamp: Date.now() - 100 * HOUR });
    expect(replyWindowOpen(t.ctx, C)).toBe(true);
    await inbound(2, 'api-1', { timestamp: Date.now() - 23 * HOUR });
    expect(replyWindowOpen(t.ctx, KEY)).toBe(true);
    expect(replyWindowOpen(t.ctx, KEY, Date.now() + 2 * HOUR)).toBe(false);
    setLastInbound(null as unknown as number);
    expect(replyWindowOpen(t.ctx, KEY)).toBe(false);
    // a key of an unknown inbox: the other refusals answer it
    expect(replyWindowOpen(t.ctx, `${C}#9`)).toBe(true);
  });
});

describe('free-form sends and the reply window', () => {
  it('sends while open; refuses text, media, voice notes and reactions with 409 window_closed', async () => {
    const m = await inbound(2, 'in-1');
    const ok = await sendText(KEY, 'open-1');
    expect(ok.statusCode).toBe(201);
    await waitFor(() => api.sent.some((s) => s.text === 'Hello'));

    closeWindow();
    const refusals = [
      await sendText(KEY, 'closed-1'),
      await upload(KEY, { clientId: 'closed-2' }, Buffer.from('%PDF-1.4 test'), 'a.pdf'),
      await upload(KEY, { clientId: 'closed-3', voiceNote: '1' }, Buffer.from('OggS'), 'v.ogg'),
      await t.app.inject({
        method: 'PUT',
        url: `/api/messages/${enc(m!.id)}/reaction`,
        headers: authHeaders(admin.cookie),
        payload: { emoji: '👍' },
      }),
    ];
    for (const res of refusals) {
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('window_closed');
    }
    expect(row('closed-1')).toBeUndefined();
    expect(api.reactions).toHaveLength(0);

    // a linked phone has no window, however old the customer's message
    await inbound(1, 'phone-old', { timestamp: Date.now() - 100 * HOUR });
    expect((await sendText(C, 'phone-1')).statusCode).toBe(201);
  });

  it('a queued free-form message whose window closes before it is sent fails with window_closed', async () => {
    await inbound(2, 'in-1');
    api.setConnected(false);
    const res = await sendText(KEY, 'queued-1');
    expect(res.statusCode).toBe(201);
    expect(row('queued-1')?.status).toBe('pending');
    closeWindow();
    api.setConnected(true);
    await waitFor(() => row('queued-1')?.status === 'failed');
    expect(row('queued-1')?.error).toBe('window_closed');
    expect(api.sent).toHaveLength(0);
    // a retry is a free-form send too
    const retry = await t.app.inject({
      method: 'POST',
      url: `/api/messages/${enc(row('queued-1')!.id)}/retry`,
      headers: authHeaders(admin.cookie),
    });
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe('window_closed');
  });
});

describe('message templates', () => {
  it('lists the inbox templates with variables and sendable, cached until refreshed', async () => {
    const res = await listTemplates(2);
    expect(res.statusCode).toBe(200);
    const { templates } = TemplateListResponse.parse(res.json());
    expect(templates.map((x) => [x.name, x.variables, x.sendable, x.header])).toEqual([
      ['order_update', 2, true, null],
      ['follow_up', 1, true, 'text'],
      ['new_menu', 1, false, 'image'],
    ]);
    expect(templates[0]).toMatchObject({ category: 'utility', language: 'en', buttons: false });
    expect(api.templateListCalls).toBe(1);
    await listTemplates(2);
    expect(api.templateListCalls).toBe(1);
    await listTemplates(2, '?refresh=1');
    expect(api.templateListCalls).toBe(2);
  });

  it('answers 409 templates_unsupported, 503 offline and 404 to anyone who cannot open the inbox', async () => {
    const phone = await listTemplates(1);
    expect(phone.statusCode).toBe(409);
    expect(phone.json().error.code).toBe('templates_unsupported');
    const agent = await createUserAndLogin(t, { role: 'agent' });
    expect((await listTemplates(2, '', agent.cookie)).statusCode).toBe(404);
    expect((await listTemplates(7)).statusCode).toBe(404);
    expect((await listTemplates(2, '?refresh=yes')).statusCode).toBe(400);
    api.setConnected(false);
    const offline = await listTemplates(2, '?refresh=1');
    expect(offline.statusCode).toBe(503);
    expect(offline.json().error.code).toBe('wa_unavailable');
  });

  it('sends an approved template after the window closed, through the queue, marked as a template', async () => {
    await inbound(2, 'in-1');
    closeWindow();
    const res = await sendTemplate(KEY, {
      name: 'order_update',
      language: 'en',
      params: ['Aminah', 'A-7'],
      clientId: 'tpl-1',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      body: 'Hi Aminah, your order A-7 is ready for pickup.',
      fromMe: true,
      sentByUserId: admin.user.id,
      template: { name: 'order_update', language: 'en' },
    });
    await waitFor(() => api.templateSends.length === 1);
    expect(api.templateSends[0]).toMatchObject({
      chatJid: C,
      template: { name: 'order_update', language: 'en', params: ['Aminah', 'A-7'] },
    });
    await waitFor(() => row('tpl-1')?.status !== 'pending');
    const sent = (await messages()).find((x) => x.clientId === 'tpl-1');
    expect(sent).toMatchObject({ template: { name: 'order_update', language: 'en' } });
    expect(sent?.status).not.toBe('failed');
    // the same clientId returns the stored message, nothing is sent again
    const again = await sendTemplate(KEY, {
      name: 'order_update',
      language: 'en',
      params: ['Aminah', 'A-7'],
      clientId: 'tpl-1',
    });
    expect(again.statusCode).toBe(201);
    expect(api.templateSends).toHaveLength(1);
    // a template does not open the window: free-form stays refused
    expect((await sendText(KEY, 'after-tpl')).statusCode).toBe(409);
  });

  it('validates the template: not found, not sendable, wrong value count, unsupported inbox', async () => {
    await inbound(2, 'in-1');
    await inbound(1, 'phone-1');
    const cases: Array<[Record<string, unknown>, number, string]> = [
      [{ name: 'nope', language: 'en', params: [] }, 400, 'template_not_found'],
      [{ name: 'order_update', language: 'ms', params: ['a', 'b'] }, 400, 'template_not_found'],
      [{ name: 'new_menu', language: 'en', params: ['a'] }, 400, 'template_not_sendable'],
      [{ name: 'order_update', language: 'en', params: ['a'] }, 400, 'template_params'],
    ];
    let n = 0;
    for (const [body, status, code] of cases) {
      const res = await sendTemplate(KEY, { ...body, clientId: `bad-${++n}` });
      expect(res.statusCode, code).toBe(status);
      expect(res.json().error.code).toBe(code);
    }
    const phone = await sendTemplate(C, {
      name: 'order_update',
      language: 'en',
      params: ['a', 'b'],
      clientId: 'bad-phone',
    });
    expect(phone.statusCode).toBe(409);
    expect(phone.json().error.code).toBe('templates_unsupported');
    expect((await sendTemplate(KEY, { name: 'x' })).statusCode).toBe(400);
    expect(api.templateSends).toHaveLength(0);
  });

  it('a failed template can be retried after the window closed', async () => {
    await inbound(2, 'in-1');
    api.failNextSend(new Error('rejected'));
    await sendTemplate(KEY, {
      name: 'follow_up',
      language: 'en',
      params: ['Aminah'],
      clientId: 'tpl-retry',
    });
    await waitFor(() => row('tpl-retry')?.status === 'failed');
    closeWindow();
    const retry = await t.app.inject({
      method: 'POST',
      url: `/api/messages/${enc(row('tpl-retry')!.id)}/retry`,
      headers: authHeaders(admin.cookie),
    });
    expect(retry.statusCode).toBe(200);
    await waitFor(() => api.templateSends.length === 1);
    expect(api.templateSends[0]!.template).toEqual({
      name: 'follow_up',
      language: 'en',
      params: ['Aminah'],
    });
  });

  it('fills and counts {{n}} variables', () => {
    expect(templateVariables('Hi {{1}}, order {{3}} and {{ 2 }}')).toBe(3);
    expect(templateVariables('No variables')).toBe(0);
    expect(fillTemplate('Hi {{1}}, {{2}}! {{4}}', ['A', 'B'])).toBe('Hi A, B! {{4}}');
  });
});

describe('AI and the reply window', () => {
  let provider: AiProvider;
  beforeEach(async () => {
    const actor = { userId: admin.user.id, ip: null };
    await t.ctx.services.ai!.shutdown();
    provider = {
      generate: vi.fn().mockResolvedValue({ reply: 'We open at 9.', action: 'answer' }),
      connection: () => ({ state: 'connected', loginUrl: null, error: null }),
      login: vi.fn(),
      logout: vi.fn(),
      shutdown: vi.fn(),
    };
    const ai = createAiService(t.ctx, { provider, isOnline: () => true });
    t.ctx.services.ai = ai;
    ai.saveConnection({ mode: 'api', model: '', apiKey: 'test-api-key-123' }, actor);
    const body = { displayName: 'Sales Agent', enabled: false, instructions: 'Be concise' };
    const created = ai.createAgent({ ...body, inboxId: 2 }, actor);
    ai.addText(created.agent.id, { name: 'Hours', text: 'Open 9 to 5.' }, actor);
    ai.saveAgent(created.agent.id, { ...body, enabled: true, inboxId: 2 }, actor);
  });

  const handoffs = () =>
    (
      t.ctx.db.prepare("SELECT meta FROM audit_log WHERE action = 'ai.handoff'").all() as Array<{
        meta: string;
      }>
    ).map((r) => (JSON.parse(r.meta) as { reason: string }).reason);

  it('hands over with window_closed before answering a chat whose window closed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // a customer message delivered late: its window is already over
    await inbound(2, 'late', { timestamp: Date.now() - 25 * HOUR });
    await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(handoffs()).toEqual(['window_closed']);
    expect(api.sent).toHaveLength(0);
    const events = t.ctx.db
      .prepare('SELECT payload FROM chat_events WHERE chat_jid = ? ORDER BY id')
      .all(KEY) as Array<{ payload: string }>;
    expect(events.some((e) => e.payload.includes('window_closed'))).toBe(true);
  });

  it('hands over with window_closed when the window closes while the reply is written', async () => {
    vi.mocked(provider.generate).mockImplementation(async () => {
      closeWindow();
      return { reply: 'We open at 9.', action: 'answer', handoffReason: null };
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await inbound(2, 'in-1');
    await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(handoffs()).toEqual(['window_closed']);
    expect(api.sent).toHaveLength(0);
  });
});

describe('MCP sends and the reply window', () => {
  const principal = (scopes: string[]): ApiPrincipal => ({
    tokenId: 7,
    user: admin.user,
    scopes: new Set(scopes) as ApiPrincipal['scopes'],
  });

  it('send_message gets the window_closed refusal text', async () => {
    await inbound(2, 'in-1');
    closeWindow();
    const port = createInboxSendPort(t.ctx);
    expect(() =>
      port.sendText(principal(['inbox:send']), { jid: KEY, text: 'Hi', requestId: 'req-closed-1' }),
    ).toThrow(/^window_closed: /);
  });

  it('send_to_new_number refuses an inbox with a reply window (template_required)', async () => {
    const port = createInboxSendPort(t.ctx);
    const call = port.sendToNewNumber(principal(['inbox:send', 'inbox:send_new']), {
      phone: '60111222333',
      text: 'Hi',
      requestId: 'req-new-api-1',
      inboxId: 2,
    });
    await expect(call).rejects.toBeInstanceOf(SendError);
    await expect(call).rejects.toThrow(/^template_required: /);
    expect(
      t.ctx.db
        .prepare('SELECT COUNT(*) AS n FROM chats WHERE wa_jid = ?')
        .get('60111222333@s.whatsapp.net'),
    ).toEqual({ n: 0 });
  });
});
