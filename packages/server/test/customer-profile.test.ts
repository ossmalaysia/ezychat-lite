import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ChatListResponse,
  CustomerProfileResponse,
  CustomerTagsResponse,
  type Chat,
} from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { CustomerRepo } from '../src/customers/repo.js';

let t: TestApp;
let cookie: string;
let seq = 0;
const enc = encodeURIComponent;
const FARAH = '60123110021@s.whatsapp.net';
const OTHER = '60199999999@s.whatsapp.net';
const empty = { name: null, company: null, email: null, otherPhone: null, address: null };

async function incoming(chatJid: string, senderName: string, body = 'hi', senderJid = chatJid) {
  seq += 1;
  await getMessages(t.ctx).ingest(
    {
      id: `cp-${seq}`,
      chatJid,
      senderJid,
      senderName,
      fromMe: false,
      type: 'text',
      body,
      quotedId: null,
      timestamp: Date.now() + seq,
      media: null,
    },
    'live',
  );
}
async function listChats(query = '') {
  const r = await t.app.inject({ method: 'GET', url: `/api/chats?${query}`, headers: { cookie } });
  expect(r.statusCode).toBe(200);
  return ChatListResponse.parse(r.json()).chats;
}
const repo = () => new CustomerRepo(t.ctx.db);

beforeEach(async () => {
  t = await makeTestApp();
  ({ cookie } = await createUserAndLogin(t));
});
afterEach(async () => t.close());

describe('chat read model with customer profiles', () => {
  it('shows the profile name with the WhatsApp name kept, and tags', async () => {
    await incoming(FARAH, 'Farah 🌸');
    repo().save(FARAH, { ...empty, name: 'Farah Aziz' }, ['VIP'], null, 1);
    const [chat] = await listChats();
    expect(chat).toMatchObject({ name: 'Farah Aziz', whatsappName: 'Farah 🌸', tags: ['VIP'] });
    expect(getChats(t.ctx).get(FARAH)).toMatchObject({ name: 'Farah Aziz' });
  });

  it('falls back to the WhatsApp name when the profile name is cleared', async () => {
    await incoming(FARAH, 'Farah 🌸');
    repo().save(FARAH, { ...empty, name: 'Farah Aziz' }, [], null, 1);
    repo().save(FARAH, empty, [], null, 2);
    const [chat] = await listChats();
    expect(chat).toMatchObject({ name: 'Farah 🌸', whatsappName: 'Farah 🌸', tags: [] });
    expect(getChats(t.ctx).get(FARAH)).toMatchObject({ name: 'Farah 🌸' });
  });

  it('searches profile fields and tags, escaping LIKE wildcards', async () => {
    await incoming(FARAH, 'Farah');
    await incoming(OTHER, 'Someone else');
    repo().save(
      FARAH,
      { ...empty, company: 'Farah Catering Co', email: 'orders@farah.my', address: 'Georgetown' },
      ['Halal catering'],
      null,
      1,
    );
    for (const q of ['Catering Co', 'orders@farah', 'halal', 'georgetown']) {
      expect((await listChats(`q=${enc(q)}`)).map((c) => c.jid)).toEqual([FARAH]);
    }
    expect(await listChats(`q=${enc('%')}`)).toEqual([]);
    expect(await listChats(`q=${enc('_')}`)).toEqual([]);
    expect(await listChats(`q=${enc('\\')}`)).toEqual([]);
  });

  it('filters by tag ignoring case, with " VIP ", "vip" and "Vip" as one tag', async () => {
    await incoming(FARAH, 'Farah');
    await incoming(OTHER, 'Someone else');
    await incoming('60188888888@s.whatsapp.net', 'Third');
    const r = repo();
    r.save(FARAH, empty, r.canonicalTags([' VIP ']), null, 1);
    r.save(OTHER, empty, r.canonicalTags(['vip']), null, 2);
    const chats = await listChats('tag=Vip');
    expect(chats.map((c) => c.jid).sort()).toEqual([FARAH, OTHER].sort());
    expect(chats.map((c) => c.tags)).toEqual([['VIP'], ['VIP']]);
    expect(await listChats('tag=wholesale')).toEqual([]);
  });

  it('gives group chats no tags or WhatsApp name', async () => {
    await incoming('120363000000001@g.us', 'Member', 'hello group', FARAH);
    const [group] = await listChats();
    expect(group?.tags ?? []).toEqual([]);
    expect(group?.whatsappName ?? null).toBeNull();
  });
});

describe('customer profile routes', () => {
  const url = (jid = FARAH) => `/api/chats/${enc(jid)}/profile`;
  const body = {
    name: 'Farah Aziz',
    company: 'Farah Catering Co',
    email: 'orders@farah.my',
    otherPhone: '',
    address: 'Georgetown',
    tags: ['VIP', 'vip ', 'Halal catering'],
  };
  const auditCount = () =>
    (
      t.ctx.db
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'customer.profile_update'")
        .get() as { n: number }
    ).n;

  it('requires sign-in', async () => {
    await incoming(FARAH, 'Farah');
    expect((await t.app.inject({ method: 'GET', url: url() })).statusCode).toBe(401);
    const put = await t.app.inject({
      method: 'PUT',
      url: url(),
      headers: { origin: 'http://localhost', host: 'localhost' },
      payload: body,
    });
    expect(put.statusCode).toBe(401);
  });

  it('lets an agent read an empty profile, save one, and audits changed fields only', async () => {
    await incoming(FARAH, 'Farah 🌸');
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const first = await t.app.inject({
      method: 'GET',
      url: url(),
      headers: { cookie: agent.cookie },
    });
    expect(first.statusCode).toBe(200);
    expect(CustomerProfileResponse.parse(first.json())).toEqual({
      profile: { ...empty, id: null, tags: [], updatedAt: null, updatedBy: null },
      whatsappName: 'Farah 🌸',
      // The number WhatsApp gave us, so the panel can show it and prefill nothing by hand.
      whatsappPhone: '60123110021',
      // Agents get the WhatsApp facts without the WhatsApp ID.
      whatsapp: expect.objectContaining({ phone: '60123110021', lid: null }),
    });
    const saved = await t.app.inject({
      method: 'PUT',
      url: url(),
      headers: authHeaders(agent.cookie),
      payload: body,
    });
    expect(saved.statusCode).toBe(200);
    expect(CustomerProfileResponse.parse(saved.json())).toMatchObject({
      profile: {
        name: 'Farah Aziz',
        otherPhone: null,
        tags: ['VIP', 'Halal catering'],
        updatedBy: agent.user.id,
      },
      whatsappName: 'Farah 🌸',
    });
    const audits = t.ctx.db
      .prepare("SELECT user_id, meta FROM audit_log WHERE action = 'customer.profile_update'")
      .all() as Array<{ user_id: number; meta: string }>;
    expect(audits).toHaveLength(1);
    expect(audits[0]!.user_id).toBe(agent.user.id);
    const meta = JSON.parse(audits[0]!.meta) as { chatJid: string; changed: string[] };
    expect(meta.chatJid).toBe(FARAH);
    expect(meta.changed.sort()).toEqual(['address', 'company', 'email', 'name', 'tags']);
    for (const value of ['Farah Aziz', 'orders@farah.my', 'Georgetown', 'Halal'])
      expect(audits[0]!.meta).not.toContain(value);
  });

  it('returns a stable customer id across saves', async () => {
    await incoming(FARAH, 'Farah');
    const put = (payload: typeof body) =>
      t.app.inject({ method: 'PUT', url: url(), headers: authHeaders(cookie), payload });
    const first = CustomerProfileResponse.parse((await put(body)).json()).profile.id;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    const second = CustomerProfileResponse.parse((await put({ ...body, name: 'Farah A.' })).json());
    expect(second.profile.id).toBe(first);
    const got = await t.app.inject({ method: 'GET', url: url(), headers: { cookie } });
    expect(CustomerProfileResponse.parse(got.json()).profile.id).toBe(first);
  });

  it("re-cases a tag only this customer uses, but keeps another customer's spelling", async () => {
    await incoming(FARAH, 'Farah');
    await incoming(OTHER, 'Other');
    const put = (jid: string, tags: string[]) =>
      t.app.inject({
        method: 'PUT',
        url: url(jid),
        headers: authHeaders(cookie),
        payload: { ...body, tags },
      });
    await put(FARAH, ['vip']);
    const recased = await put(FARAH, ['VIP']);
    expect(CustomerProfileResponse.parse(recased.json()).profile.tags).toEqual(['VIP']);
    const other = await put(OTHER, ['Vip']);
    expect(CustomerProfileResponse.parse(other.json()).profile.tags).toEqual(['VIP']);
  });

  it('rejects an email that would smuggle mailto headers', async () => {
    await incoming(FARAH, 'Farah');
    const r = await t.app.inject({
      method: 'PUT',
      url: url(),
      headers: authHeaders(cookie),
      payload: { ...body, email: 'a@b.co?bcc=evil@x.co' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain('email');
    expect(auditCount()).toBe(0);
  });

  it('writes nothing when nothing changed', async () => {
    await incoming(FARAH, 'Farah');
    const put = () =>
      t.app.inject({ method: 'PUT', url: url(), headers: authHeaders(cookie), payload: body });
    expect((await put()).statusCode).toBe(200);
    const updatedAt = new CustomerRepo(t.ctx.db).get(FARAH)!.updatedAt;
    expect((await put()).statusCode).toBe(200);
    expect(auditCount()).toBe(1);
    expect(new CustomerRepo(t.ctx.db).get(FARAH)!.updatedAt).toBe(updatedAt);
  });

  it('clearing the name over PUT brings back the WhatsApp name', async () => {
    await incoming(FARAH, 'Farah 🌸');
    await t.app.inject({ method: 'PUT', url: url(), headers: authHeaders(cookie), payload: body });
    const cleared = await t.app.inject({
      method: 'PUT',
      url: url(),
      headers: authHeaders(cookie),
      payload: { ...body, name: '   ' },
    });
    expect(CustomerProfileResponse.parse(cleared.json()).profile.name).toBeNull();
    const [chat] = await listChats();
    expect(chat).toMatchObject({ name: 'Farah 🌸', whatsappName: 'Farah 🌸' });
  });

  it('rejects invalid fields, group chats, missing chats and cross-origin writes', async () => {
    await incoming(FARAH, 'Farah');
    const bad = await t.app.inject({
      method: 'PUT',
      url: url(),
      headers: authHeaders(cookie),
      payload: { email: 'nope' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('email');

    await incoming('120363000000001@g.us', 'Member', 'hi', FARAH);
    const group = await t.app.inject({
      method: 'GET',
      url: url('120363000000001@g.us'),
      headers: { cookie },
    });
    expect(group.statusCode).toBe(400);
    const groupPut = await t.app.inject({
      method: 'PUT',
      url: url('120363000000001@g.us'),
      headers: authHeaders(cookie),
      payload: body,
    });
    expect(groupPut.statusCode).toBe(400);

    const missing = await t.app.inject({
      method: 'GET',
      url: url('60100000000@s.whatsapp.net'),
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);

    const cross = await t.app.inject({
      method: 'PUT',
      url: url(),
      headers: { cookie, origin: 'http://evil.example', host: 'localhost' },
      payload: body,
    });
    expect(cross.statusCode).toBe(403);
    expect(auditCount()).toBe(0);
  });

  it('lists what WhatsApp tells us; only admins see the WhatsApp ID', async () => {
    const LID = '888000222@lid';
    await incoming(LID, 'Farah 🌸');
    t.ctx.services.aliases!.learn({ jid: FARAH, alias: LID }, 'message');
    t.ctx.db
      .prepare(
        'INSERT OR REPLACE INTO contacts (jid, push_name, saved_name, phone) VALUES (?, ?, ?, ?)',
      )
      .run(FARAH, 'Farah 🌸', 'Farah (catering)', '60123110021');
    const admin = await createUserAndLogin(t, { role: 'admin' });
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const read = async (c: string) =>
      CustomerProfileResponse.parse(
        (await t.app.inject({ method: 'GET', url: url(LID), headers: { cookie: c } })).json(),
      ).whatsapp;
    expect(await read(admin.cookie)).toEqual({
      pushName: 'Farah 🌸',
      savedName: 'Farah (catering)',
      phone: '60123110021',
      lid: LID,
    });
    expect(await read(agent.cookie)).toEqual({
      pushName: 'Farah 🌸',
      savedName: 'Farah (catering)',
      phone: '60123110021',
      lid: null,
    });
  });

  it('resolves an alias JID to the merged chat', async () => {
    const LID = '888000111@lid';
    await incoming(LID, 'Farah');
    t.ctx.services.aliases!.learn({ jid: FARAH, alias: LID }, 'message');
    const r = await t.app.inject({
      method: 'PUT',
      url: url(FARAH),
      headers: authHeaders(cookie),
      payload: body,
    });
    expect(r.statusCode).toBe(200);
    expect(new CustomerRepo(t.ctx.db).get(LID)).toMatchObject({ name: 'Farah Aziz' });
  });

  it('emits chat:updated with the new name and tags', async () => {
    await incoming(FARAH, 'Farah');
    const seen: Chat[] = [];
    t.ctx.bus.on('chat:updated', (c) => seen.push(c));
    await t.app.inject({ method: 'PUT', url: url(), headers: authHeaders(cookie), payload: body });
    expect(seen.at(-1)).toMatchObject({
      jid: FARAH,
      name: 'Farah Aziz',
      whatsappName: 'Farah',
      tags: ['VIP', 'Halal catering'],
    });
  });

  it('suggests existing tags by prefix', async () => {
    await incoming(FARAH, 'Farah');
    await t.app.inject({ method: 'PUT', url: url(), headers: authHeaders(cookie), payload: body });
    const r = await t.app.inject({
      method: 'GET',
      url: '/api/customer-tags?q=ha',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(CustomerTagsResponse.parse(r.json()).tags).toEqual(['Halal catering']);
    const all = await t.app.inject({
      method: 'GET',
      url: '/api/customer-tags',
      headers: { cookie },
    });
    expect(CustomerTagsResponse.parse(all.json()).tags.sort()).toEqual(['Halal catering', 'VIP']);
    expect((await t.app.inject({ method: 'GET', url: '/api/customer-tags' })).statusCode).toBe(401);
  });
});

describe('group messages', () => {
  const GROUP = '120363000000001@g.us';
  const LID = '888000111@lid';

  async function groupMessages() {
    const r = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc(GROUP)}/messages`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    return (r.json() as { messages: Array<{ senderJid: string; senderProfile?: unknown }> })
      .messages;
  }

  it('carries the sender profile from their direct chat, list and live', async () => {
    await incoming(FARAH, 'Farah');
    repo().save(FARAH, { ...empty, name: 'Farah Aziz' }, [], null, 1);
    const live: unknown[] = [];
    t.ctx.bus.on('message:new', (m) => live.push(m.senderProfile));
    await incoming(GROUP, 'Farah 🌸', 'hello group', FARAH);
    expect(live.at(-1)).toEqual({ chatJid: FARAH, name: 'Farah Aziz' });
    const [msg] = await groupMessages();
    expect(msg?.senderProfile).toEqual({ chatJid: FARAH, name: 'Farah Aziz' });
  });

  it('resolves a phone-number sender whose profile sits on the LID chat', async () => {
    await incoming(LID, 'Farah');
    t.ctx.services.aliases!.learn({ jid: FARAH, alias: LID }, 'message');
    repo().save(LID, { ...empty, name: 'Farah Aziz' }, [], null, 1);
    await incoming(GROUP, 'Farah 🌸', 'hello group', FARAH);
    const [msg] = await groupMessages();
    expect(msg?.senderProfile).toEqual({ chatJid: LID, name: 'Farah Aziz' });
  });

  it('resolves a LID sender whose profile sits on the phone-number chat', async () => {
    await incoming(FARAH, 'Farah');
    t.ctx.services.aliases!.learn({ jid: FARAH, alias: LID }, 'message');
    repo().save(FARAH, { ...empty, name: 'Farah Aziz' }, [], null, 1);
    await incoming(GROUP, 'Farah 🌸', 'hello group', LID);
    const [msg] = await groupMessages();
    expect(msg?.senderProfile).toEqual({ chatJid: FARAH, name: 'Farah Aziz' });
  });

  it('leaves senders without a direct chat or profile name alone', async () => {
    await incoming(OTHER, 'Other');
    repo().save(OTHER, { ...empty, company: 'No name Co' }, ['VIP'], null, 1);
    await incoming(GROUP, 'Stranger', 'hi', '60111111111@s.whatsapp.net');
    await incoming(GROUP, 'Other', 'hi', OTHER);
    const msgs = await groupMessages();
    expect(msgs.map((m) => m.senderProfile ?? null)).toEqual([null, null]);
  });

  it('keeps the sender profile on a redownloaded group message', async () => {
    await incoming(FARAH, 'Farah');
    repo().save(FARAH, { ...empty, name: 'Farah Aziz' }, [], null, 1);
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    await getMessages(t.ctx).ingest(
      {
        id: 'grp-img',
        chatJid: GROUP,
        senderJid: FARAH,
        senderName: 'Farah 🌸',
        fromMe: false,
        type: 'image',
        body: null,
        quotedId: null,
        timestamp: Date.now(),
        media: { mime: 'image/png', fileName: null, download: async () => png },
      },
      'history',
    );
    t.wa.setMedia('grp-img', png);
    const msg = await getMessages(t.ctx).redownload('grp-img');
    expect(msg.senderProfile).toEqual({ chatJid: FARAH, name: 'Farah Aziz' });
  });

  it('adds no sender profile to direct-chat messages', async () => {
    await incoming(FARAH, 'Farah');
    repo().save(FARAH, { ...empty, name: 'Farah Aziz' }, [], null, 1);
    await incoming(FARAH, 'Farah', 'again');
    const r = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc(FARAH)}/messages`,
      headers: { cookie },
    });
    const msgs = (r.json() as { messages: Array<{ senderProfile?: unknown }> }).messages;
    expect(msgs.every((m) => m.senderProfile === undefined)).toBe(true);
  });
});
