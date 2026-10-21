import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageSchema, type InboxStatusPayload } from '@ezychat/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { createMessageService } from '../src/messages/service.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp({ maxInboxes: 3, inboxes: 2 });
});
afterEach(async () => {
  await t.close();
});

const enc = encodeURIComponent;
const C = '60123000111@s.whatsapp.net';
const C2 = `${C}#2`;
const G = '120363000000000001@g.us';
const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
async function waitFor(fn: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}
const row = (id: string) =>
  t.ctx.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as
    | {
        id: string;
        chat_jid: string;
        status: string;
        sender_jid: string | null;
        quoted_id: string | null;
        media_status: string;
        media_path: string | null;
      }
    | undefined;
const messagesOf = (chatJid: string) =>
  t.ctx.db
    .prepare('SELECT * FROM messages WHERE chat_jid = ? ORDER BY timestamp')
    .all(chatJid) as Array<{
    id: string;
    status: string;
    from_me: number;
  }>;

async function send(cookie: string, chatJid: string, text: string, clientId: string) {
  const r = await t.app.inject({
    method: 'POST',
    url: `/api/chats/${enc(chatJid)}/messages`,
    headers: authHeaders(cookie),
    payload: { text, clientId },
  });
  return r;
}

function multipart(
  fields: Record<string, string>,
  file: { name: string; mime: string; data: Buffer },
) {
  const boundary = '----mib' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields))
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('multi-inbox messages', () => {
  it('same customer, two numbers, two chats; each reply leaves from its own number (RF-1)', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    t.inboxWa(1).simulateIncoming({ chatJid: C, body: 'hi number one', senderName: 'Ann' });
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'hi number two', senderName: 'Ann' });
    await settle();
    expect(getChats(t.ctx).get(C)).not.toBeNull();
    expect(getChats(t.ctx).get(C2)).not.toBeNull();
    const inboxOf = (jid: string) =>
      (
        t.ctx.db.prepare('SELECT inbox_id FROM chats WHERE jid = ?').get(jid) as {
          inbox_id: number;
        }
      ).inbox_id;
    expect(inboxOf(C)).toBe(1);
    expect(inboxOf(C2)).toBe(2);
    expect(messagesOf(C)).toHaveLength(1);
    expect(messagesOf(C2)).toHaveLength(1);
    // the inbox 2 message id carries the inbox suffix
    expect(messagesOf(C2)[0]!.id).toMatch(/#2$/);
    expect(messagesOf(C)[0]!.id).not.toContain('#');

    const r = await send(cookie, C2, 'reply from two', 'mi-1');
    expect(r.statusCode).toBe(201);
    expect(MessageSchema.parse(r.json()).chatJid).toBe(C2);
    await waitFor(() => t.inboxWa(2).sent.length === 1);
    expect(t.inboxWa(2).sent[0]).toMatchObject({ chatJid: C, text: 'reply from two' });
    expect(t.inboxWa(1).sent).toHaveLength(0);
    await waitFor(() => row('local-mi-1') === undefined);
    const sent = t.ctx.db.prepare('SELECT * FROM messages WHERE client_id = ?').get('mi-1') as {
      id: string;
      chat_jid: string;
    };
    expect(sent.id).toBe(`${t.inboxWa(2).sent[0]!.id}#2`);
    expect(sent.chat_jid).toBe(C2);

    const r1 = await send(cookie, C, 'reply from one', 'mi-2');
    expect(r1.statusCode).toBe(201);
    await waitFor(() => t.inboxWa(1).sent.length === 1);
    expect(t.inboxWa(1).sent[0]).toMatchObject({ chatJid: C, text: 'reply from one' });
    expect(t.inboxWa(2).sent).toHaveLength(1);
  });

  it('same group message id in two inboxes keeps both rows; receipts stay in their inbox (RF-2)', async () => {
    const msgs = getMessages(t.ctx);
    const base = {
      id: 'G1',
      chatJid: G,
      senderJid: '60111222333@s.whatsapp.net',
      senderName: 'Bob',
      fromMe: false,
      type: 'text' as const,
      body: 'group hello',
      quotedId: null,
      timestamp: Date.now(),
      media: null,
    };
    expect(await msgs.ingest(base, 'live', 1)).not.toBeNull();
    expect(await msgs.ingest(base, 'live', 2)).not.toBeNull();
    expect(row('G1')!.chat_jid).toBe(G);
    expect(row('G1#2')!.chat_jid).toBe(`${G}#2`);

    // a reply quoting G1 in inbox 2 points at inbox 2's copy
    t.inboxWa(2).simulateIncoming({
      id: 'G2',
      chatJid: G,
      body: 'reply',
      quotedId: 'G1',
      senderJid: base.senderJid,
    });
    await settle();
    expect(row('G2#2')!.quoted_id).toBe('G1#2');

    // receipts: our own sends are 'sent'; an inbox 2 receipt for an id that inbox 1 also has
    t.ctx.db
      .prepare("UPDATE messages SET from_me = 1, status = 'sent' WHERE id IN ('G1', 'G1#2')")
      .run();
    t.inboxWa(2).emit('messageStatus', { id: 'G1', chatJid: G, status: 'read' });
    await settle();
    expect(row('G1#2')!.status).toBe('read');
    expect(row('G1')!.status).toBe('sent');
    msgs.applyStatus({ id: 'G1', chatJid: G, status: 'delivered' }, 1);
    expect(row('G1')!.status).toBe('delivered');
    expect(row('G1#2')!.status).toBe('read');
  });

  it('one phone offline does not stop the other (RF-4)', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    t.inboxWa(1).simulateIncoming({ chatJid: C, body: 'one' });
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'two' });
    await settle();
    t.inboxWa(2).setConnected(false);
    expect((await send(cookie, C2, 'to two', 'off-2')).statusCode).toBe(201);
    expect((await send(cookie, C, 'to one', 'off-1')).statusCode).toBe(201);
    await waitFor(() => t.inboxWa(1).sent.length === 1);
    await settle();
    expect(t.inboxWa(2).sent).toHaveLength(0);
    expect(row('local-off-2')!.status).toBe('pending');
    expect(getMessages(t.ctx).queueFor(2).size).toBe(1);
    expect(getMessages(t.ctx).queueFor(1)).toBe(getMessages(t.ctx).queue);
    t.inboxWa(2).setConnected(true);
    await waitFor(() => t.inboxWa(2).sent.length === 1);
    expect(t.inboxWa(2).sent[0]).toMatchObject({ chatJid: C, text: 'to two' });
  });

  it('outgoing rows carry the inbox own number', async () => {
    const { user } = await createUserAndLogin(t, { role: 'admin' });
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'two' });
    await settle();
    const m = getMessages(t.ctx).sendText(C2, { clientId: 'own-1', text: 'x' }, user.id);
    const me2 = t.inboxWa(2).status.me!.jid;
    expect(me2).not.toBe(t.inboxWa(1).status.me!.jid);
    expect(row(m.id)?.sender_jid ?? null).toBe(me2);
  });

  it('a reply quotes with the WhatsApp id, without the inbox suffix', async () => {
    const { user } = await createUserAndLogin(t, { role: 'admin' });
    t.inboxWa(2).simulateIncoming({ id: 'Q1', chatJid: C, body: 'question' });
    await settle();
    getMessages(t.ctx).sendText(C2, { clientId: 'q-1', text: 'answer', quotedId: 'Q1#2' }, user.id);
    await waitFor(() => t.inboxWa(2).sent.length === 1);
    expect(t.inboxWa(2).sent[0]!.reply).toMatchObject({ quotedId: 'Q1', quoted: { id: 'Q1' } });
  });

  it('media download asks the chat own adapter with the WhatsApp id', async () => {
    t.inboxWa(2).simulateIncoming({
      id: 'IMG1',
      chatJid: C,
      body: '',
      type: 'image',
      media: {
        mime: 'image/png',
        fileName: null,
        download: async () => {
          throw new Error('cdn gone');
        },
      },
    });
    await waitFor(() => row('IMG1#2')?.media_status === 'failed');
    t.inboxWa(2).setMedia('IMG1', Buffer.from('png-bytes'));
    const m = await getMessages(t.ctx).redownload('IMG1#2');
    expect(m.id).toBe('IMG1#2');
    const r = row('IMG1#2')!;
    expect(r.media_status).toBe('ok');
    // inbox 2 files live in their own folder: the same JID and id in inbox 1 never collide
    expect(r.media_path).toBe('inbox-2/60123000111_s_whatsapp_net/IMG1.png');
    const file = getMessages(t.ctx).mediaPath('IMG1#2');
    expect(file?.mime).toBe('image/png');
  });

  it('a pending inbox 2 row restored on start goes to its own queue', async () => {
    const { user } = await createUserAndLogin(t, { role: 'admin' });
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'two' });
    await settle();
    t.inboxWa(2).setConnected(false);
    getMessages(t.ctx).sendText(C2, { clientId: 'rs-1', text: 'after restart' }, user.id);
    getMessages(t.ctx).shutdown();
    const restarted = createMessageService(t.ctx);
    try {
      expect(restarted.queueFor(2).size).toBe(1);
      expect(restarted.queueFor(1).size).toBe(0);
      t.inboxWa(2).setConnected(true);
      restarted.queueFor(2).onConnected();
      await waitFor(() => t.inboxWa(2).sent.length === 1);
      expect(t.inboxWa(2).sent[0]).toMatchObject({ chatJid: C, text: 'after restart' });
      expect(t.inboxWa(1).sent).toHaveLength(0);
    } finally {
      restarted.shutdown();
    }
  });

  it('a pending row of an inbox removed while the server was down fails on start', async () => {
    const { user } = await createUserAndLogin(t, { role: 'admin' });
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'two' });
    await settle();
    t.inboxWa(2).setConnected(false);
    getMessages(t.ctx).sendText(C2, { clientId: 'gone-1', text: 'never sent' }, user.id);
    getMessages(t.ctx).shutdown();
    await t.ctx.inboxes.connections.remove(2);
    t.ctx.inboxes.repo.markRemoved(2, Date.now());
    const restarted = createMessageService(t.ctx);
    try {
      expect(row('local-gone-1')).toMatchObject({ status: 'failed' });
      expect(restarted.queue.size).toBe(0);
      expect(() => restarted.retry('local-gone-1', user.id)).toThrow('inbox_removed');
    } finally {
      restarted.shutdown();
    }
  });

  it('a pending row of an active inbox with no connection in this build stays pending on start', async () => {
    const { user } = await createUserAndLogin(t, { role: 'admin' });
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'two' });
    await settle();
    t.inboxWa(2).setConnected(false);
    getMessages(t.ctx).sendText(C2, { clientId: 'over-1', text: 'kept' }, user.id);
    getMessages(t.ctx).shutdown();
    // the row stays active but gets no connection, as an inbox over the build's inbox limit
    await t.ctx.inboxes.connections.remove(2);
    expect(t.ctx.inboxes.repo.get(2)!.removed_at).toBeNull();
    const restarted = createMessageService(t.ctx);
    try {
      expect(row('local-over-1')).toMatchObject({ status: 'pending' });
      expect(restarted.queue.size).toBe(0);
      expect(() => restarted.queueFor(2)).toThrow();
      expect(() => restarted.sendText(C2, { clientId: 'over-2', text: 'no' }, user.id)).toThrow(
        'inbox_not_connected',
      );
      expect(row('local-over-2')).toBeUndefined();
    } finally {
      restarted.shutdown();
    }
  });

  it('a media send whose clientId holds # is stored and sent (not read as a message key)', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'two' });
    await settle();
    const mp = multipart(
      { clientId: 'x#2' },
      { name: 'a.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4') },
    );
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(C2)}/media`,
      headers: { ...authHeaders(cookie), 'content-type': mp.contentType },
      payload: mp.payload,
    });
    expect(r.statusCode).toBe(201);
    await waitFor(() => t.inboxWa(2).sent.length === 1);
    expect(t.inboxWa(2).sent[0]).toMatchObject({ chatJid: C });
    expect(t.inboxWa(1).sent).toHaveLength(0);
    const sent = messagesOf(C2).find((m) => m.from_me === 1)!;
    expect(row(sent.id)!.media_path).toBe('inbox-2/60123000111_s_whatsapp_net/local-x_2.pdf');
  });

  it('every inbox reports its status on the bus; wa:status stays inbox 1', async () => {
    const inboxStatus: InboxStatusPayload[] = [];
    const waStatus: string[] = [];
    t.ctx.bus.on('inbox:status', (p) => inboxStatus.push(p));
    t.ctx.bus.on('wa:status', (s) => waStatus.push(s.state));
    t.inboxWa(2).setConnected(false);
    expect(inboxStatus.at(-1)).toMatchObject({ inboxId: 2, status: { state: 'disconnected' } });
    expect(waStatus).toEqual([]);
    expect(t.ctx.services.waStatus?.state).toBe('open');
    t.inboxWa(1).setConnected(false);
    expect(inboxStatus.at(-1)).toMatchObject({ inboxId: 1, status: { state: 'disconnected' } });
    expect(waStatus).toEqual(['disconnected']);
    t.inboxWa(2).setConnected(true);
    // the inbox's own number is remembered for alias learning after an unlink
    expect(t.ctx.inboxes.repo.get(2)!.own_jid).toBe(t.inboxWa(2).status.me!.jid);
  });

  it('names each inbox own number in group mentions, also after the inbox is removed', async () => {
    const me2 = t.inboxWa(2).status.me!;
    const digits = me2.jid.split('@')[0]!;
    t.inboxWa(2).simulateIncoming({
      id: 'MN1',
      chatJid: G,
      body: `hi @${digits}`,
      senderJid: '60111222333@s.whatsapp.net',
      mentionedJids: [me2.jid],
    });
    await settle();
    const present = () =>
      getMessages(t.ctx).present(
        t.ctx.db.prepare("SELECT * FROM messages WHERE id = 'MN1#2'").get() as never,
      );
    expect(present().body).toBe(`hi @${me2.name}`);
    expect(t.ctx.inboxes.repo.get(2)!.own_jid).toBe(me2.jid);
    await t.ctx.inboxes.connections.remove(2);
    t.ctx.inboxes.repo.markRemoved(2, Date.now());
    // still the inbox's own number (not a customer), but no session name any more
    expect(present().body).toBe(`hi @${digits}`);
  });

  it('dev routes simulate messages, groups and a link scan per inbox', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    const post = (url: string, payload: unknown) =>
      t.app.inject({
        method: 'POST',
        url,
        headers: authHeaders(cookie),
        payload: payload as object,
      });
    const r = await post('/api/dev/fake-incoming', { inboxId: 2, chatJid: C, text: 'dev two' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ chatJid: C2 });
    expect(r.json().id).toMatch(/^FAKE2-.*#2$/);
    expect(row(r.json().id)!.chat_jid).toBe(C2);
    const r1 = await post('/api/dev/fake-incoming', { chatJid: C, text: 'dev one' });
    expect(r1.json()).toMatchObject({ chatJid: C });
    expect(r1.json().id).not.toContain('#');

    expect(
      (await post('/api/dev/fake-incoming', { inboxId: 9, chatJid: C, text: 'x' })).statusCode,
    ).toBe(404);

    t.inboxWa(2).setConnected(false);
    const link = await post('/api/dev/fake-link', { inboxId: 2 });
    expect(link.statusCode).toBe(200);
    expect(link.json()).toEqual({ inboxId: 2, state: 'open' });
    expect(t.inboxWa(2).status.state).toBe('open');
    expect((await post('/api/dev/fake-link', { inboxId: 9 })).statusCode).toBe(404);
    expect((await post('/api/dev/fake-link', {})).statusCode).toBe(400);

    const g = await post('/api/dev/fake-group', {
      inboxId: 2,
      groupJid: G,
      name: 'Team two',
      generated: 2,
    });
    expect(g.statusCode).toBe(200);
    expect(g.json()).toEqual({ groupJid: `${G}#2`, members: 3 });
    expect(getChats(t.ctx).get(`${G}#2`)).not.toBeNull();
    expect(getChats(t.ctx).get(G)).toBeNull();
  });

  it('an inbox added later gets its bridge and queue; a removed one stops and refuses sends', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    const id = await t.addInbox('Support');
    expect(id).toBe(3);
    const C3 = `${C}#3`;
    t.inboxWa(3).simulateIncoming({ chatJid: C, body: 'three' });
    await settle();
    expect(messagesOf(C3)).toHaveLength(1);

    t.inboxWa(3).setConnected(false);
    expect((await send(cookie, C3, 'waits', 'rm-1')).statusCode).toBe(201);
    const wa3 = t.inboxWa(3);
    await t.ctx.inboxes.connections.remove(3);
    t.ctx.inboxes.repo.markRemoved(3, Date.now());
    await settle();
    // the pending message of the removed inbox fails instead of waiting forever
    expect(row('local-rm-1')!.status).toBe('failed');
    // no ingest after detach (the inbound message and the failed reply stay)
    expect(messagesOf(C3)).toHaveLength(2);
    wa3.simulateIncoming({ chatJid: C, body: 'late' });
    await settle();
    expect(messagesOf(C3)).toHaveLength(2);
    const r = await send(cookie, C3, 'no', 'rm-2');
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: { code: 'conflict', message: 'inbox_removed' } });
    expect(() => getMessages(t.ctx).queueFor(3)).toThrow();
  });
});
