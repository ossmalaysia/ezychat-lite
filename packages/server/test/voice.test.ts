import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MessageSchema,
  VOICE_NOTE_MAX_BYTES,
  VOICE_NOTE_MIME,
  type Message,
} from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { getMessages } from '../src/wa-bridge/index.js';
import { createMessageService } from '../src/messages/service.js';
import { oggOpus, opusPackets, webmOpus } from './voice-fixtures.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

const enc = encodeURIComponent;
const JID = '60177777777@s.whatsapp.net';

async function waitFor(fn: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function seed() {
  await getMessages(t.ctx).ingest(
    {
      id: 'IN-0',
      chatJid: JID,
      senderJid: JID,
      senderName: 'Gus',
      fromMe: false,
      type: 'text',
      body: 'hello',
      quotedId: null,
      timestamp: 1_700_000_000_000,
      media: null,
    },
    'live',
  );
}

function multipart(
  fields: Record<string, string>,
  file: { name: string; mime: string; data: Buffer },
) {
  const boundary = '----watiboundary' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    ),
  );
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function postVoice(
  cookie: string,
  data: Buffer,
  clientId = 'v-1',
  mime = 'audio/webm;codecs=opus',
) {
  const mp = multipart({ clientId }, { name: 'voice.webm', mime, data });
  return t.app.inject({
    method: 'POST',
    url: `/api/chats/${enc(JID)}/voice`,
    headers: { ...authHeaders(cookie), 'content-type': mp.contentType },
    payload: mp.payload,
  });
}

describe('voice notes', () => {
  it('stores a WebM recording as an OGG/Opus voice note and sends it as push-to-talk', async () => {
    const { cookie, user } = await createUserAndLogin(t);
    await seed();
    const emitted: Message[] = [];
    t.ctx.bus.on('message:new', (m) => emitted.push(m));

    const r = await postVoice(cookie, webmOpus(opusPackets(4.8)));
    expect(r.statusCode).toBe(201);
    const m = MessageSchema.parse(r.json());
    expect(m).toMatchObject({
      id: 'local-v-1',
      type: 'audio',
      voice: true,
      mediaMime: VOICE_NOTE_MIME,
      fromMe: true,
      sentByUserId: user.id,
      status: 'pending',
    });
    // the realtime payload (bus → Socket.IO) marks it as a voice note too
    const live = emitted.find((e) => e.id === 'local-v-1');
    expect(MessageSchema.parse(live).voice).toBe(true);

    await waitFor(() => t.wa.sent.length === 1);
    const sent = t.wa.sent[0]!;
    expect(sent.chatJid).toBe(JID);
    expect(sent.ptt).toBe(true);
    expect(sent.seconds).toBeGreaterThan(4.7);
    expect(sent.seconds).toBeLessThan(4.9);
    expect(sent.file!.mime).toBe(VOICE_NOTE_MIME);
    expect(sent.file!.buffer.subarray(0, 4).toString('latin1')).toBe('OggS');
    expect(t.wa.presences).toContainEqual({ chatJid: JID, presence: 'recording' });
    expect(t.wa.presences.some((p) => p.presence === 'composing')).toBe(false);

    // stored like other media and served inline as OGG/Opus
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/media/${enc(sent.id)}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(VOICE_NOTE_MIME);
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.rawPayload.subarray(0, 4).toString('latin1')).toBe('OggS');

    const list = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc(JID)}/messages`,
      headers: { cookie },
    });
    const listed = (list.json() as { messages: Message[] }).messages.find((x) => x.id === sent.id);
    expect(listed?.voice).toBe(true);
  });

  it('accepts a Firefox OGG/Opus recording', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    const r = await postVoice(cookie, oggOpus(opusPackets(2)), 'v-ogg', 'audio/ogg;codecs=opus');
    expect(r.statusCode).toBe(201);
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]!.ptt).toBe(true);
  });

  it('rejects a file that is not an Opus recording', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const r = await postVoice(cookie, png, 'v-png', 'image/png');
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toMatch(/OGG\/Opus or WebM\/Opus/);
    expect(t.wa.sent).toHaveLength(0);
  });

  it('rejects a broken OGG header', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    const bad = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(80, 9)]);
    const r = await postVoice(cookie, bad, 'v-bad', 'audio/ogg');
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toMatch(/Invalid OGG/);
  });

  it('rejects a recording longer than five minutes', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    const r = await postVoice(cookie, webmOpus(opusPackets(310)), 'v-long');
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toMatch(/5 minutes/);
    const row = t.ctx.db.prepare('SELECT id FROM messages WHERE client_id = ?').get('v-long');
    expect(row).toBeUndefined();
  });

  it('rejects an upload over the voice-note size limit', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    const r = await postVoice(cookie, Buffer.alloc(VOICE_NOTE_MAX_BYTES + 1024, 1), 'v-big');
    expect(r.statusCode).toBe(413);
  });

  it('requires a clientId and a file', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    const mp = multipart(
      {},
      { name: 'v.webm', mime: 'audio/webm', data: webmOpus(opusPackets(1)) },
    );
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(JID)}/voice`,
      headers: { ...authHeaders(cookie), 'content-type': mp.contentType },
      payload: mp.payload,
    });
    expect(r.statusCode).toBe(400);
  });

  it('re-posting the same clientId does not create a second voice note', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    t.wa.setConnected(false);
    const a = await postVoice(cookie, webmOpus(opusPackets(1)), 'v-dup');
    const b = await postVoice(cookie, webmOpus(opusPackets(1)), 'v-dup');
    expect(a.statusCode).toBe(201);
    expect(b.json().id).toBe(a.json().id);
    const n = t.ctx.db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE client_id = ?')
      .get('v-dup') as {
      n: number;
    };
    expect(n.n).toBe(1);
  });

  it('a voice note still pending at restart is sent as push-to-talk', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    t.wa.setConnected(false);
    expect((await postVoice(cookie, webmOpus(opusPackets(1.2)), 'v-restart')).statusCode).toBe(201);
    getMessages(t.ctx).shutdown();
    const restarted = createMessageService(t.ctx);
    t.wa.setConnected(true);
    restarted.queue.onConnected();
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]).toMatchObject({ ptt: true });
    expect(t.wa.sent[0]!.seconds).toBeGreaterThan(1);
    restarted.shutdown();
  });

  it('an ordinary .opus attachment stays a plain audio file', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seed();
    const mp = multipart(
      { clientId: 'a-opus' },
      { name: 'song.opus', mime: 'audio/ogg', data: oggOpus(opusPackets(1)) },
    );
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(JID)}/media`,
      headers: { ...authHeaders(cookie), 'content-type': mp.contentType },
      payload: mp.payload,
    });
    expect(r.statusCode).toBe(201);
    expect(MessageSchema.parse(r.json()).voice).toBeFalsy();
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]!.ptt).toBeUndefined();
    expect(t.wa.presences.some((p) => p.presence === 'composing')).toBe(true);
  });

  describe('received audio', () => {
    async function ingestAudio(id: string, voice: boolean | undefined, mime = VOICE_NOTE_MIME) {
      return getMessages(t.ctx).ingest(
        {
          id,
          chatJid: JID,
          senderJid: JID,
          senderName: 'Gus',
          fromMe: false,
          type: 'audio',
          body: null,
          quotedId: null,
          timestamp: 1_700_000_100_000,
          media: { mime, fileName: null, download: async () => oggOpus(opusPackets(1)) },
          ...(voice === undefined ? {} : { voice }),
        },
        'live',
      );
    }

    it('a WhatsApp push-to-talk note is labelled as a voice note, also after reloading', async () => {
      const { cookie } = await createUserAndLogin(t);
      const m = await ingestAudio('IN-PTT', true);
      expect(m?.voice).toBe(true);
      const list = await t.app.inject({
        method: 'GET',
        url: `/api/chats/${enc(JID)}/messages`,
        headers: { cookie },
      });
      const listed = (list.json() as { messages: Message[] }).messages.find(
        (x) => x.id === 'IN-PTT',
      );
      expect(listed?.voice).toBe(true);
      expect(listed?.mediaMime).toBe(VOICE_NOTE_MIME);
    });

    it('an OGG/Opus audio file that is not push-to-talk is not labelled', async () => {
      const m = await ingestAudio('IN-FILE', false);
      expect(m?.voice).toBeFalsy();
      expect(m?.mediaMime).toBe('audio/ogg');
      expect((await ingestAudio('IN-UNKNOWN', undefined))?.voice).toBeFalsy();
    });

    it('push-to-talk with another audio type is not labelled', async () => {
      const m = await ingestAudio('IN-PTT-MP4', true, 'audio/mp4');
      expect(m?.voice).toBeFalsy();
      expect(m?.mediaMime).toBe('audio/mp4');
    });
  });
});
