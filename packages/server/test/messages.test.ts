import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageListResponse, MessageSchema } from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { createMessageService } from '../src/messages/service.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

const enc = encodeURIComponent;
const JID = '60177777777@s.whatsapp.net';
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

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function seed(n = 1) {
  for (let i = 0; i < n; i++) {
    await getMessages(t.ctx).ingest(
      {
        id: `IN-${i}`,
        chatJid: JID,
        senderJid: JID,
        senderName: 'Gus',
        fromMe: false,
        type: 'text',
        body: `m${i}`,
        quotedId: null,
        timestamp: 1_700_000_000_000 + i * 1000,
        media: null,
      },
      'live',
    );
  }
}

function multipart(fields: Record<string, string>, file: { name: string; mime: string; data: Buffer }) {
  const boundary = '----watiboundary' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    ),
  );
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('messages routes', () => {
  it('lists messages ascending with before-cursor paging', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed(5);
    let r = await t.app.inject({ method: 'GET', url: `/api/chats/${enc(JID)}/messages?limit=3`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const p1 = MessageListResponse.parse(r.json());
    expect(p1.messages.map((m) => m.body)).toEqual(['m2', 'm3', 'm4']);
    expect(p1.nextBefore).not.toBeNull();
    r = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc(JID)}/messages?limit=3&before=${enc(p1.nextBefore!)}`,
      headers: { cookie },
    });
    const p2 = MessageListResponse.parse(r.json());
    expect(p2.messages.map((m) => m.body)).toEqual(['m0', 'm1']);
    expect(p2.nextBefore).toBeNull();
  });

  it('send text via FakeWaAdapter ends with status sent and the WA id', async () => {
    const { user, cookie } = await createUserAndLogin(t);
    await seed();
    const statuses: Array<{ id: string; clientId: string | null; status: string; newId?: string }> = [];
    t.ctx.bus.on('message:status', (s) => statuses.push(s));
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(JID)}/messages`,
      headers: authHeaders(cookie),
      payload: { text: 'Hello there', clientId: 'c-1' },
    });
    expect(r.statusCode).toBe(201);
    const m = MessageSchema.parse(r.json());
    expect(m.id).toBe('local-c-1');
    expect(m.status).toBe('pending');
    expect(m.sentByUserId).toBe(user.id);
    expect(m.fromMe).toBe(true);

    await waitFor(() => statuses.some((s) => s.clientId === 'c-1' && s.status === 'sent'));
    const sentEv = statuses.find((s) => s.status === 'sent')!;
    expect(sentEv.newId).toBe('FAKE-OUT-1');
    expect(sentEv.id).toBe('FAKE-OUT-1');
    expect(t.wa.sent[0]).toMatchObject({ chatJid: JID, text: 'Hello there' });
    await settle();
    const row = t.ctx.db.prepare('SELECT id, status, client_id FROM messages WHERE client_id = ?').get('c-1') as {
      id: string;
      status: string;
    };
    expect(row.id).toBe('FAKE-OUT-1');
    expect(['sent', 'delivered']).toContain(row.status);
    expect(t.wa.presences.some((p) => p.chatJid === JID && p.presence === 'composing')).toBe(true);
  });

  it('re-posting the same clientId does not create a duplicate', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    t.wa.setConnected(false);
    for (let i = 0; i < 2; i++) {
      const r = await t.app.inject({
        method: 'POST',
        url: `/api/chats/${enc(JID)}/messages`,
        headers: authHeaders(cookie),
        payload: { text: 'once', clientId: 'dup' },
      });
      expect(r.statusCode).toBe(201);
    }
    const n = (t.ctx.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE client_id='dup'").get() as { n: number }).n;
    expect(n).toBe(1);
  });

  it('send while WA disconnected stays pending, then sends on reconnect', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    t.wa.setConnected(false);
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(JID)}/messages`,
      headers: authHeaders(cookie),
      payload: { text: 'later', clientId: 'c-2' },
    });
    expect(r.statusCode).toBe(201);
    await settle();
    const row = () => t.ctx.db.prepare('SELECT id, status FROM messages WHERE client_id = ?').get('c-2') as { id: string; status: string };
    expect(row().status).toBe('pending');
    expect(t.wa.sent.length).toBe(0);
    t.wa.setConnected(true);
    await waitFor(() => row().status !== 'pending');
    expect(row().id).toMatch(/^FAKE-OUT-/);
  });

  it('send failure → failed; retry re-sends', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    t.wa.failNextSend(new Error('nope'));
    await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(JID)}/messages`,
      headers: authHeaders(cookie),
      payload: { text: 'try', clientId: 'c-3' },
    });
    const row = () =>
      t.ctx.db.prepare('SELECT id, status, error FROM messages WHERE client_id = ?').get('c-3') as {
        id: string;
        status: string;
        error: string | null;
      };
    await waitFor(() => row().status === 'failed');
    expect(row().error).toBe('nope');
    const r = await t.app.inject({ method: 'POST', url: `/api/messages/local-c-3/retry`, headers: authHeaders(cookie) });
    expect(r.statusCode).toBe(200);
    expect(MessageSchema.parse(r.json()).status).toBe('pending');
    await waitFor(() => row().id.startsWith('FAKE-OUT-'));
  });

  it('an ERROR ack that arrives before the id rename leaves the message failed', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    // the fake adapter's next outgoing id is FAKE-OUT-1; its failure ack races ahead of the send result
    getMessages(t.ctx).applyStatus({ id: 'FAKE-OUT-1', chatJid: JID, status: 'failed' });
    await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(JID)}/messages`,
      headers: authHeaders(cookie),
      payload: { text: 'doomed', clientId: 'c-early' },
    });
    const row = () =>
      t.ctx.db.prepare('SELECT id, status, error FROM messages WHERE client_id = ?').get('c-early') as {
        id: string;
        status: string;
        error: string | null;
      };
    await waitFor(() => row().id === 'FAKE-OUT-1');
    await settle();
    expect(row().status).toBe('failed');
    expect(row().error).toBe('Delivery failed');
  });

  it('a message failed by WhatsApp after the rename (WA id) can be retried', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(JID)}/messages`,
      headers: authHeaders(cookie),
      payload: { text: 'retry me', clientId: 'c-wa' },
    });
    const row = () =>
      t.ctx.db.prepare('SELECT id, status FROM messages WHERE client_id = ?').get('c-wa') as { id: string; status: string };
    await waitFor(() => row().id.startsWith('FAKE-OUT-'));
    const waId = row().id;
    await settle();
    // simulate WhatsApp rejecting it after the rename (ERROR ack on the WA-id row)
    t.ctx.db.prepare("UPDATE messages SET status = 'failed', error = 'Delivery failed' WHERE id = ?").run(waId);
    expect(row().status).toBe('failed');
    const statuses: Array<{ id: string; newId?: string; status: string }> = [];
    t.ctx.bus.on('message:status', (s) => statuses.push(s));
    const r = await t.app.inject({ method: 'POST', url: `/api/messages/${enc(waId)}/retry`, headers: authHeaders(cookie) });
    expect(r.statusCode).toBe(200);
    const m = MessageSchema.parse(r.json());
    expect(m.status).toBe('pending');
    expect(m.id).toBe('local-c-wa');
    expect(statuses[0]).toMatchObject({ id: waId, newId: 'local-c-wa', status: 'pending' });
    await waitFor(() => row().id.startsWith('FAKE-OUT-') && row().id !== waId);
    expect(t.wa.sent.filter((x) => x.text === 'retry me').length).toBe(2);
  });

  it('media upload of a PNG stores and serves it with correct content-type and Range 206', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    const mp = multipart({ clientId: 'c-img', caption: 'look' }, { name: 'dot.png', mime: 'application/octet-stream', data: PNG });
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(JID)}/media`,
      headers: { ...authHeaders(cookie), 'content-type': mp.contentType },
      payload: mp.payload,
    });
    expect(r.statusCode).toBe(201);
    const m = MessageSchema.parse(r.json());
    expect(m.type).toBe('image');
    expect(m.mediaMime).toBe('image/png');
    expect(m.body).toBe('look');
    expect(m.mediaUrl).toBe(`/api/media/${m.id}`);

    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]!.file!.mime).toBe('image/png');
    await settle();
    const row = t.ctx.db.prepare('SELECT id FROM messages WHERE client_id = ?').get('c-img') as { id: string };

    let res = await t.app.inject({ method: 'GET', url: `/api/media/${enc(row.id)}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['content-disposition'])).toMatch(/^inline/);
    expect(res.rawPayload.equals(PNG)).toBe(true);

    res = await t.app.inject({ method: 'GET', url: `/api/media/${enc(row.id)}`, headers: { cookie, range: 'bytes=0-9' } });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-9/${PNG.length}`);
    expect(res.rawPayload.equals(PNG.subarray(0, 10))).toBe(true);

    res = await t.app.inject({ method: 'GET', url: `/api/media/${enc(row.id)}`, headers: { cookie, range: 'bytes=9999-' } });
    expect(res.statusCode).toBe(416);
  });

  it('non-image media is served as attachment', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    const mp = multipart({ clientId: 'c-doc' }, { name: 'notes.txt', mime: 'text/plain', data: Buffer.from('hello world') });
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(JID)}/media`,
      headers: { ...authHeaders(cookie), 'content-type': mp.contentType },
      payload: mp.payload,
    });
    expect(r.statusCode).toBe(201);
    const m = MessageSchema.parse(r.json());
    expect(m.type).toBe('document');
    const res = await t.app.inject({ method: 'GET', url: `/api/media/${enc(m.id)}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-disposition'])).toMatch(/^attachment; filename="notes.txt"/);
  });

  const ingestHistoryImage = (id: string) =>
    getMessages(t.ctx).ingest(
      {
        id,
        chatJid: JID,
        senderJid: JID,
        senderName: 'Gus',
        fromMe: false,
        type: 'image',
        body: null,
        quotedId: null,
        timestamp: 1_700_000_000_000,
        media: { mime: 'image/png', fileName: null, download: async () => PNG },
      },
      'history',
    );

  it('GET /api/media/:id on pending history media downloads on demand, then serves it', async () => {
    const { cookie } = await createUserAndLogin(t);
    const m = await ingestHistoryImage('HIST-IMG-1');
    expect(m!.mediaStatus).toBe('pending');
    t.wa.setMedia('HIST-IMG-1', PNG);
    const res = await t.app.inject({ method: 'GET', url: `/api/media/HIST-IMG-1`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.equals(PNG)).toBe(true);
    const row = t.ctx.db.prepare('SELECT media_status FROM messages WHERE id = ?').get('HIST-IMG-1') as { media_status: string };
    expect(row.media_status).toBe('ok');
  });

  it('GET /api/media/:id on pending media that cannot be downloaded → 404 media_pending', async () => {
    const { cookie } = await createUserAndLogin(t);
    await ingestHistoryImage('HIST-IMG-2');
    const res = await t.app.inject({ method: 'GET', url: `/api/media/HIST-IMG-2`, headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('media_pending');
  });

  it('media requires auth and unknown id → 404', async () => {
    const { cookie } = await createUserAndLogin(t);
    let res = await t.app.inject({ method: 'GET', url: `/api/media/nope` });
    expect(res.statusCode).toBe(401);
    res = await t.app.inject({ method: 'GET', url: `/api/media/nope`, headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});

describe('ownership on reply', () => {
  it('the first EzyChat reply to an unassigned chat assigns it to the sender', async () => {
    const { user, cookie } = await createUserAndLogin(t, { role: 'agent' });
    await seed();
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(JID)}/messages`,
      headers: authHeaders(cookie),
      payload: { text: 'Hello Gus', clientId: 'own-1' },
    });
    expect(res.statusCode).toBe(201);
    expect(getChats(t.ctx).get(JID)?.assignedTo).toBe(user.id);
    const events = getChats(t.ctx).events(JID);
    expect(events.map((e) => e.type)).toEqual(['assigned']);
    expect(events[0]).toMatchObject({
      actorId: user.id,
      payload: { assignedTo: user.id, previous: null, reason: 'reply' },
    });
  });

  it('a media reply assigns too, and a repeated clientId does not add a second event', async () => {
    const { user } = await createUserAndLogin(t, { role: 'agent' });
    await seed();
    await getMessages(t.ctx).sendMedia(JID, { buffer: PNG, fileName: 'a.png' }, user.id, 'own-media');
    await getMessages(t.ctx).sendMedia(JID, { buffer: PNG, fileName: 'a.png' }, user.id, 'own-media');
    expect(getChats(t.ctx).get(JID)?.assignedTo).toBe(user.id);
    expect(getChats(t.ctx).events(JID).map((e) => e.type)).toEqual(['assigned']);
  });

  it('replying never takes over a chat another teammate owns', async () => {
    const owner = await createUserAndLogin(t, { role: 'agent' });
    const other = await createUserAndLogin(t, { role: 'agent' });
    await seed();
    getChats(t.ctx).patch(JID, { assignedTo: owner.user.id }, owner.user.id);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(JID)}/messages`,
      headers: authHeaders(other.cookie),
      payload: { text: 'Covering for you', clientId: 'own-2' },
    });
    expect(res.statusCode).toBe(201);
    expect(getChats(t.ctx).get(JID)?.assignedTo).toBe(owner.user.id);
    expect(getChats(t.ctx).events(JID).map((e) => e.type)).toEqual(['assigned']);
  });

  it('a reply sent from the WhatsApp phone app assigns nobody', async () => {
    await seed();
    await getMessages(t.ctx).ingest(
      {
        id: 'FROM-PHONE',
        chatJid: JID,
        senderJid: null,
        senderName: null,
        fromMe: true,
        type: 'text',
        body: 'typed on the phone',
        quotedId: null,
        timestamp: 1_700_000_100_000,
        media: null,
      },
      'live',
    );
    expect(getChats(t.ctx).get(JID)?.assignedTo).toBeNull();
    expect(getChats(t.ctx).events(JID)).toEqual([]);
  });
});

describe('replies and receipts for one person with two addresses', () => {
  const PN = '60111111111@s.whatsapp.net';
  const LID = '123456789@lid';
  const inbound = (id: string, chatJid: string, ts: number, chatJidAlt: string | null = null) =>
    getMessages(t.ctx).ingest(
      {
        id,
        chatJid,
        chatJidAlt,
        senderJid: chatJid,
        senderName: 'Aisyah',
        fromMe: false,
        type: 'text',
        body: id,
        quotedId: null,
        timestamp: ts,
        media: null,
      },
      'live',
    );

  it('replies go to the address of the last inbound message and composing uses it too', async () => {
    const { user } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('L-1', LID, 1000, PN);
    await inbound('P-2', PN, 2000);
    getMessages(t.ctx).sendText(LID, { clientId: 'reply-1', text: 'hello' }, user.id);
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]!.chatJid).toBe(PN);
    expect(t.wa.presences.some((p) => p.chatJid === PN && p.presence === 'composing')).toBe(true);
    expect(
      t.ctx.db
        .prepare("SELECT chat_jid, wa_remote_jid FROM messages WHERE client_id = 'reply-1'")
        .get(),
    ).toEqual({ chat_jid: LID, wa_remote_jid: PN });
  });

  it('never replies to a phone number that has since moved to another WhatsApp ID', async () => {
    const { user } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('L-1', LID, 1000, PN);
    await inbound('P-2', PN, 2000);
    getChats(t.ctx).upsertContactAliases([{ jid: PN, alias: '987654321@lid' }]); // number recycled
    getMessages(t.ctx).sendText(LID, { clientId: 'moved-1', text: 'hello' }, user.id);
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]!.chatJid).toBe(LID);
  });

  it('read receipts are sent per WhatsApp address', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('L-1', LID, 1000, PN);
    await inbound('P-2', PN, 2000);
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(LID)}/read`,
      headers: authHeaders(cookie),
    });
    expect(r.statusCode).toBe(200);
    expect(t.wa.reads).toEqual([
      { chatJid: LID, messageIds: ['L-1'] },
      { chatJid: PN, messageIds: ['P-2'] },
    ]);
  });

  it('the echo of our own send to the PN is stored once, in the LID chat', async () => {
    const { user } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('L-1', LID, 1000, PN);
    await inbound('P-2', PN, 2000);
    getMessages(t.ctx).sendText(LID, { clientId: 'echo-1', text: 'echo me' }, user.id);
    await waitFor(() => t.wa.sent.length === 1);
    const waId = t.wa.sent[0]!.id;
    t.wa.simulateIncoming({ id: waId, chatJid: PN, fromMe: true, body: 'echo me' });
    await settle();
    expect(t.ctx.db.prepare('SELECT chat_jid FROM messages WHERE id = ?').all(waId)).toEqual([
      { chat_jid: LID },
    ]);
  });

  it('a retry never goes to a phone number that has since moved to another WhatsApp ID', async () => {
    const { user, cookie } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('L-1', LID, 1000, PN);
    await inbound('P-2', PN, 2000);
    t.wa.failNextSend(new Error('nope'));
    getMessages(t.ctx).sendText(LID, { clientId: 'retry-moved', text: 'hello' }, user.id);
    const row = () =>
      t.ctx.db
        .prepare('SELECT id, status, wa_remote_jid FROM messages WHERE client_id = ?')
        .get('retry-moved') as { id: string; status: string; wa_remote_jid: string };
    await waitFor(() => row().status === 'failed');
    expect(row().wa_remote_jid).toBe(PN);
    getChats(t.ctx).upsertContactAliases([{ jid: PN, alias: '987654321@lid' }]); // number recycled
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/messages/local-retry-moved/retry`,
      headers: authHeaders(cookie),
    });
    expect(r.statusCode).toBe(200);
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]!.chatJid).toBe(LID);
    expect(row().wa_remote_jid).toBe(LID);
  });

  it('refuses to send from a phone-number chat whose number now belongs to someone else', async () => {
    const { user } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('P-1', PN, 1000);
    getChats(t.ctx).upsertContactAliases([{ jid: PN, alias: '555555555@lid' }]);
    getChats(t.ctx).upsertContactAliases([{ jid: PN, alias: '987654321@lid' }]);
    expect(() =>
      getMessages(t.ctx).sendText(PN, { clientId: 'stale-1', text: 'hello' }, user.id),
    ).toThrow(/now belongs to a different WhatsApp account/);
    await settle();
    expect(t.wa.sent.length).toBe(0);
  });

  it('a retry from such a chat is marked failed and nothing is sent', async () => {
    const { user, cookie } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('P-1', PN, 1000);
    getChats(t.ctx).upsertContactAliases([{ jid: PN, alias: '555555555@lid' }]);
    t.wa.failNextSend(new Error('nope'));
    getMessages(t.ctx).sendText(PN, { clientId: 'stale-2', text: 'hello' }, user.id);
    const row = () =>
      t.ctx.db
        .prepare('SELECT status, error FROM messages WHERE client_id = ?')
        .get('stale-2') as { status: string; error: string };
    await waitFor(() => row().status === 'failed');
    getChats(t.ctx).upsertContactAliases([{ jid: PN, alias: '987654321@lid' }]);
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/messages/local-stale-2/retry',
      headers: authHeaders(cookie),
    });
    expect(r.statusCode).toBe(200);
    await settle();
    expect(row()).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/different WhatsApp account/),
    });
    expect(t.wa.sent.length).toBe(0);
  });

  it('restored pending sends after a restart still go to their stored target', async () => {
    const { user } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('L-1', LID, 1000, PN);
    await inbound('P-2', PN, 2000);
    t.wa.setConnected(false);
    getMessages(t.ctx).sendText(LID, { clientId: 'restart-1', text: 'after restart' }, user.id);
    getMessages(t.ctx).shutdown();
    const restarted = createMessageService(t.ctx);
    t.wa.setConnected(true);
    restarted.queue.onConnected();
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]!.chatJid).toBe(PN);
    restarted.shutdown();
  });
});
