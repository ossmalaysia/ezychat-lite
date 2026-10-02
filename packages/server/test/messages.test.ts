import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageListResponse, MessageSchema } from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { getMessages } from '../src/wa-bridge/index.js';

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

  it('media requires auth and unknown id → 404', async () => {
    const { cookie } = await createUserAndLogin(t);
    let res = await t.app.inject({ method: 'GET', url: `/api/media/nope` });
    expect(res.statusCode).toBe(401);
    res = await t.app.inject({ method: 'GET', url: `/api/media/nope`, headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});
