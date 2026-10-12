import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatListResponse, MessageSchema } from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { craftedNote } from './fixtures/ogg.js';
import { getMessages } from '../src/wa-bridge/index.js';
import {
  VOICE_NOTE_MAX_BYTES,
  voiceNoteSeconds,
  voiceNoteWaveform,
} from '../src/messages/voice-note.js';

const TONE = readFileSync(new URL('./fixtures/tone-1s.ogg', import.meta.url));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const JID = '60177777777@s.whatsapp.net';
const enc = encodeURIComponent;

let t: TestApp;
let cookie: string;
beforeEach(async () => {
  t = await makeTestApp();
  ({ cookie } = await createUserAndLogin(t));
  await getMessages(t.ctx).ingest(
    {
      id: 'IN-0',
      chatJid: JID,
      senderJid: JID,
      senderName: 'Gus',
      fromMe: false,
      type: 'text',
      body: 'hi',
      quotedId: null,
      timestamp: Date.now(),
      media: null,
    },
    'live',
  );
});
afterEach(async () => t.close());

function upload(fields: Record<string, string>, data: Buffer, name = 'voice-note.ogg') {
  const boundary = '----voice' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = Object.entries(fields).map(([k, v]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
  );
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: audio/ogg\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return t.app.inject({
    method: 'POST',
    url: `/api/chats/${enc(JID)}/media`,
    headers: {
      ...authHeaders(cookie),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat(parts),
  });
}

async function waitFor(fn: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('voice note helpers', () => {
  it('counts whole seconds from the Opus packets and draws a 64-bar waveform', () => {
    expect(voiceNoteSeconds(TONE)).toBe(1);
    const bars = voiceNoteWaveform(TONE);
    expect(bars).toHaveLength(64);
    expect(Math.max(...bars)).toBeLessThanOrEqual(100);
  });

  it('keeps memory fixed: empty packets padding a note change nothing', () => {
    // One Ogg page of 255 zero-length packets; a crafted note can repeat it millions of times.
    const empty = Buffer.alloc(27 + 255);
    empty.write('OggS', 0, 'latin1');
    empty[26] = 255;
    const padded = Buffer.concat([TONE, ...Array.from({ length: 2000 }, () => empty)]);
    expect(voiceNoteWaveform(padded)).toEqual(voiceNoteWaveform(TONE));
  });

  it('refuses a "voice note" far larger than any recording', () => {
    expect(voiceNoteSeconds(Buffer.concat([TONE, Buffer.alloc(VOICE_NOTE_MAX_BYTES)]))).toBeNull();
  });

  it('refuses anything that is not Ogg/Opus, and notes over five minutes', () => {
    expect(voiceNoteSeconds(PNG)).toBeNull();
    expect(voiceNoteSeconds(craftedNote(11))).toBeNull(); // ~5.6 min of real packets
  });
});

describe('sending a voice note', () => {
  it('sends the recording to WhatsApp as a voice note with its length and waveform', async () => {
    const r = await upload({ clientId: 'vn-1', voiceNote: '1' }, TONE);
    expect(r.statusCode).toBe(201);
    const msg = MessageSchema.parse(r.json());
    expect(msg).toMatchObject({
      type: 'audio',
      voiceNote: true,
      mediaMime: 'audio/ogg; codecs=opus',
      mediaName: null,
    });
    await waitFor(() => t.wa.sent.length === 1);
    const file = t.wa.sent[0]!.file!;
    expect(file.voiceNote?.seconds).toBe(1);
    expect(file.voiceNote?.waveform).toHaveLength(64);
    const chats = ChatListResponse.parse(
      (await t.app.inject({ method: 'GET', url: '/api/chats', headers: { cookie } })).json(),
    ).chats;
    expect(chats.find((c) => c.jid === JID)?.lastMessagePreview).toBe('[Voice note]');
  });

  it('keeps it a voice note when it is re-sent after a restart', async () => {
    t.wa.simulateStatus({ state: 'disconnected' });
    await upload({ clientId: 'vn-2', voiceNote: '1' }, TONE);
    const row = t.ctx.db
      .prepare("SELECT voice_note FROM messages WHERE client_id = 'vn-2'")
      .get() as {
      voice_note: number;
    };
    expect(row.voice_note).toBe(1);
  });

  it('refuses a voice note that is not Ogg/Opus, is too long, or has a caption', async () => {
    expect((await upload({ clientId: 'vn-3', voiceNote: '1' }, PNG, 'x.png')).statusCode).toBe(400);
    expect(
      (await upload({ clientId: 'vn-4', voiceNote: '1' }, Buffer.from(craftedNote(11)))).statusCode,
    ).toBe(400);
    expect(
      (await upload({ clientId: 'vn-5', voiceNote: '1', caption: 'hi' }, TONE)).statusCode,
    ).toBe(400);
    expect(t.wa.sent).toHaveLength(0);
  });

  it('still sends an ordinary audio file as a file', async () => {
    expect((await upload({ clientId: 'vn-6' }, TONE, 'song.ogg')).statusCode).toBe(201);
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]!.file!.voiceNote).toBeUndefined();
  });
});
