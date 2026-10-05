import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AiProvider } from '../src/ai/provider-types.js';
import { createAiService } from '../src/ai/service.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

/** Business context items: uploaded files and text content, like a project knowledge panel. */
let t: TestApp;
let provider: AiProvider;
let cookie: string;
let actor: { userId: number; ip: null };
const member = { displayName: 'Sales Agent', enabled: false, instructions: 'Be brief' };

beforeEach(async () => {
  provider = {
    generate: vi.fn().mockResolvedValue({ reply: 'RM10', action: 'answer' }),
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  t = await makeTestApp({
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
      ctx.services.ai = createAiService(ctx, { provider });
    },
  });
  const auth = t.ctx.services.auth!;
  const admin = auth.createUser({
    username: 'admin',
    displayName: 'Admin',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  actor = { userId: admin.id, ip: null };
  cookie = `sid=${auth.createSession(admin.id, { ip: '127.0.0.1', userAgent: 't' })}`;
  t.ctx.services.ai!.saveConnection({ mode: 'api', model: '', apiKey: 'test-api-key-123' }, actor);
});
afterEach(async () => {
  await t.close();
  vi.useRealTimers();
});

const ai = () => t.ctx.services.ai!;
const inject = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: authHeaders(cookie), ...(payload ? { payload } : {}) });
const rows = () =>
  t.ctx.db
    .prepare('SELECT name, kind, size, text FROM ai_documents ORDER BY created_at, id')
    .all() as Array<{ name: string; kind: string; size: number; text: string }>;

it('creates, edits and deletes a text item over HTTP with the size in UTF-8 bytes', async () => {
  ai().saveMember(member, actor);
  const created = await inject('POST', '/api/ai/documents/text', {
    name: '  Price list ',
    text: 'Kek coklat RM50 😀',
  });
  expect(created.statusCode, created.body).toBe(200);
  const [item] = created.json().documents;
  expect(item).toMatchObject({
    name: 'Price list',
    kind: 'text',
    size: Buffer.byteLength('Kek coklat RM50 😀'),
    characters: 17,
  });
  expect(item.updatedAt).toBe(item.createdAt);
  const view = await inject('GET', `/api/ai/documents/${item.id}`);
  expect(view.json()).toMatchObject({
    id: item.id,
    name: 'Price list',
    kind: 'text',
    text: 'Kek coklat RM50 😀',
    truncated: false,
  });

  const renamed = await inject('PATCH', `/api/ai/documents/${item.id}`, { name: 'Prices' });
  expect(renamed.statusCode, renamed.body).toBe(200);
  expect(rows()).toEqual([
    {
      name: 'Prices',
      kind: 'text',
      size: Buffer.byteLength('Kek coklat RM50 😀'),
      text: 'Kek coklat RM50 😀',
    },
  ]);
  const edited = await inject('PATCH', `/api/ai/documents/${item.id}`, { text: 'Cake RM45' });
  expect(edited.json().documents[0]).toMatchObject({ name: 'Prices', size: 9, characters: 9 });

  const audit = t.ctx.db
    .prepare("SELECT action, meta FROM audit_log WHERE action LIKE 'ai.document%' ORDER BY id")
    .all() as Array<{ action: string; meta: string }>;
  expect(audit.map((row) => row.action)).toEqual([
    'ai.document_add',
    'ai.document_update',
    'ai.document_update',
  ]);
  expect(audit.map((row) => row.meta).join()).not.toMatch(/RM|Cake|Kek/);

  expect((await inject('DELETE', `/api/ai/documents/${item.id}`)).statusCode).toBe(200);
  expect(rows()).toEqual([]);
  expect((await inject('GET', `/api/ai/documents/${item.id}`)).statusCode).toBe(404);
});

it('validates text items and refuses to edit a file item or a missing item', async () => {
  ai().saveMember(member, actor);
  for (const payload of [
    { name: '', text: 'x' },
    { name: 'n'.repeat(121), text: 'x' },
    { name: 'A', text: '   ' },
    { name: 'A', text: 'x'.repeat(100_001) },
  ])
    expect((await inject('POST', '/api/ai/documents/text', payload)).statusCode).toBe(400);
  expect(
    (await inject('POST', '/api/ai/documents/text', { name: 'A', text: '😀'.repeat(100_000) }))
      .statusCode,
  ).toBe(200);
  const file = ai().addDocument('hours.md', 8, 'Open 9am', actor).documents.at(-1)!;
  expect(file.kind).toBe('file');
  const patchFile = await inject('PATCH', `/api/ai/documents/${file.id}`, { text: 'Hacked' });
  expect(patchFile.statusCode).toBe(400);
  expect(patchFile.json().error.message).toContain('Only text content can be edited');
  expect(rows().at(-1)).toMatchObject({ kind: 'file', text: 'Open 9am' });
  expect((await inject('PATCH', '/api/ai/documents/999', { name: 'X' })).statusCode).toBe(404);
  expect((await inject('PATCH', `/api/ai/documents/${file.id}`, {})).statusCode).toBe(400);
});

it('needs the AI member before adding text and allows at most 20 items', async () => {
  const early = await inject('POST', '/api/ai/documents/text', { name: 'A', text: 'x' });
  expect(early.statusCode).toBe(409);
  ai().saveMember(member, actor);
  for (let i = 0; i < 19; i++) ai().addText({ name: `Item ${i}`, text: 'x' }, actor);
  ai().addDocument('last.md', 1, 'y', actor);
  const full = await inject('POST', '/api/ai/documents/text', { name: 'One more', text: 'x' });
  expect(full.statusCode).toBe(400);
  expect(full.json().error.message).toContain('up to 20');
});

it('views a file item as a read-only, truncated preview of its extracted text', async () => {
  ai().saveMember(member, actor);
  const long = `Menu\n\n${'Nasi lemak RM8. '.repeat(3000)}`;
  const file = ai().addDocument('menu.pdf', 4096, long, actor).documents[0]!;
  const view = await inject('GET', `/api/ai/documents/${file.id}`);
  expect(view.statusCode).toBe(200);
  const body = view.json();
  expect(body).toMatchObject({ name: 'menu.pdf', kind: 'file', size: 4096, truncated: true });
  expect(body.text.length).toBe(20_000);
  expect(long.startsWith(body.text)).toBe(true);
});

it('turns on only with at least one context item that has text', () => {
  expect(() => ai().saveMember({ ...member, enabled: true }, actor)).toThrow(
    'Add business context before turning on the AI member',
  );
  ai().saveMember(member, actor);
  const id = ai().addText({ name: 'Hours', text: 'Open 9am' }, actor).documents[0]!.id;
  expect(ai().saveMember({ ...member, enabled: true }, actor).settings.enabled).toBe(true);
  ai().removeDocument(id, actor);
  expect(() => ai().saveMember({ ...member, enabled: true }, actor)).toThrow(
    'Add business context',
  );
  ai().addDocument('hours.md', 8, 'Open 9am', actor);
  expect(ai().saveMember({ ...member, enabled: true }, actor).settings.enabled).toBe(true);
});

it('sends context items oldest first so the knowledge prefix stays byte-stable', async () => {
  ai().saveMember(member, actor);
  ai().addText({ name: 'Company', text: 'Kedai Ezy sells cakes.' }, actor);
  ai().addDocument('delivery.md', 12, 'Delivery RM10', actor);
  ai().addText({ name: 'Hours', text: 'Open 9am' }, actor);
  // Editing an item never moves it: order follows the created date, then id.
  const company = ai().status().documents[0]!;
  ai().updateText(company.id, { text: 'Kedai Ezy sells cakes and bread.' }, actor);
  await ai().tryAnswer({
    question: 'Delivery?',
    knowledge: { displayName: 'A', instructions: '' },
  });
  await ai().tryAnswer({ question: 'Hours?', knowledge: { displayName: 'A', instructions: '' } });
  const [first, second] = vi
    .mocked(provider.generate)
    .mock.calls.map((call) => JSON.parse(call[2].input).businessKnowledge as string);
  expect(first).toBe(
    '[Company]\nKedai Ezy sells cakes and bread.\n\n[delivery.md]\nDelivery RM10\n\n[Hours]\nOpen 9am',
  );
  expect(second).toBe(first);
  expect(
    ai()
      .status()
      .documents.map((doc) => doc.name),
  ).toEqual(['Company', 'delivery.md', 'Hours']);
});

it('Try it answers from the saved items plus the draft name and instructions', async () => {
  ai().saveMember(member, actor);
  ai().addText({ name: 'Delivery', text: 'Delivery costs RM10.' }, actor);
  const result = await ai().tryAnswer({
    question: 'How much is delivery?',
    knowledge: { displayName: 'Draft Agent', instructions: 'Draft rules' },
  });
  expect(result).toMatchObject({ ok: true, reply: 'RM10' });
  const prompt = vi.mocked(provider.generate).mock.calls[0]![2];
  expect(prompt.instructions).toContain('named Draft Agent');
  expect(prompt.instructions).toContain('Draft rules');
  expect(JSON.parse(prompt.input).businessKnowledge).toBe('[Delivery]\nDelivery costs RM10.');
  // With no saved items there is nothing to answer from: hand off without calling the model.
  ai().removeDocument(ai().status().documents[0]!.id, actor);
  expect(
    await ai().tryAnswer({
      question: 'Delivery?',
      knowledge: { displayName: 'A', instructions: '' },
    }),
  ).toMatchObject({ ok: true, action: 'handoff', model: null });
  expect(provider.generate).toHaveBeenCalledTimes(1);
});

const restart = async () => {
  await t.ctx.services.ai!.shutdown();
  t.ctx.services.ai = createAiService(t.ctx, { provider });
};

it.each([
  [
    'notes and FAQs (older shape)',
    {
      displayName: 'Sales Agent',
      instructions: 'Be kind',
      notes: 'Open 9am to 5pm.',
      faqs: [{ question: 'Open on Sunday?', answer: 'No' }],
    },
    'Open 9am to 5pm.\n\nQ: Open on Sunday?\nA: No',
  ],
  [
    'a Business context text (Task 11 shape)',
    { displayName: 'Sales Agent', instructions: 'Be kind', context: 'Delivery RM10 😀' },
    'Delivery RM10 😀',
  ],
])('migrates %s into one "Business context" text item, once', async (_name, stored, text) => {
  ai().saveMember(member, actor);
  t.ctx.settings.set('ai_sales_member', stored);
  await restart();
  const status = ai().status();
  expect(status.settings).toMatchObject({ instructions: 'Be kind' });
  expect(status.settings).not.toHaveProperty('context');
  expect(status.documents).toEqual([
    expect.objectContaining({
      name: 'Business context',
      kind: 'text',
      size: Buffer.byteLength(text),
    }),
  ]);
  expect(rows()[0]!.text).toBe(text);
  const saved = t.ctx.settings.get<Record<string, unknown>>('ai_sales_member', {});
  expect(saved).not.toHaveProperty('context');
  expect(saved).not.toHaveProperty('notes');
  expect(saved).not.toHaveProperty('faqs');
  expect(saved).toMatchObject({ instructions: 'Be kind' });
  // Idempotent: more reads, a restart and even a stale legacy value never add a second item.
  ai().status();
  await restart();
  ai().status();
  t.ctx.settings.set('ai_sales_member', stored);
  ai().status();
  expect(rows()).toHaveLength(1);
  expect(t.ctx.settings.get('ai_sales_member', {})).not.toHaveProperty('context');
});

it('migrates an empty legacy context by dropping the field without creating an item', async () => {
  ai().saveMember(member, actor);
  t.ctx.settings.set('ai_sales_member', {
    displayName: 'Sales Agent',
    instructions: 'Hi',
    context: '  ',
    notes: '',
    faqs: [],
  });
  await restart();
  expect(ai().status().documents).toEqual([]);
  expect(t.ctx.settings.get('ai_sales_member', {})).toEqual({
    displayName: 'Sales Agent',
    instructions: 'Hi',
  });
});

it('leaves an already migrated (current shape) member and its items alone', async () => {
  ai().saveMember(member, actor);
  ai().addText({ name: 'Hours', text: 'Open 9am' }, actor);
  const before = t.ctx.settings.get('ai_sales_member', {});
  await restart();
  ai().status();
  expect(t.ctx.settings.get('ai_sales_member', {})).toEqual(before);
  expect(rows().map((row) => row.name)).toEqual(['Hours']);
});

it('keeps only the first 100,000 code points of very large legacy notes in the migrated item', async () => {
  ai().saveMember(member, actor);
  t.ctx.settings.set('ai_sales_member', {
    instructions: '',
    notes: 'a'.repeat(90_000),
    faqs: [{ question: 'Q', answer: 'b'.repeat(20_000) }],
  });
  await restart();
  expect(ai().status().documents[0]).toMatchObject({
    name: 'Business context',
    characters: 100_000,
  });
});
