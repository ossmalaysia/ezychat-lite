import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, VoiceStatus } from '@wa-team-inbox/shared';
import { AI_SECRET_KEY } from '../src/ai/settings-keys.js';
import { createVoiceService, type VoiceServiceDeps } from '../src/voice/service.js';
import type { VoiceModelFile } from '../src/voice/model.js';
import { getMessages } from '../src/wa-bridge/index.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

const TONE = readFileSync(join(import.meta.dirname, 'fixtures/tone-1s.ogg'));
const TRANSCRIPT = 'Do you deliver to Penang tomorrow?';
const jid = 'customer@s.whatsapp.net';
const MODEL: Record<string, Buffer> = {
  'small-encoder.int8.onnx': Buffer.from('enc'),
  'small-decoder.int8.onnx': Buffer.from('dec'),
  'small-tokens.txt': Buffer.from('tok'),
};
const MODEL_FILES: VoiceModelFile[] = Object.entries(MODEL).map(([name, bytes]) => ({
  name,
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}));

let t: TestApp;
let cookie: string;
let actor: { userId: number; ip: null };
let lines: string[];
let transcribe: ReturnType<typeof vi.fn<NonNullable<VoiceServiceDeps['transcribe']>>>;

/** Replaces the voice service with one using fakes and a log capture. */
async function voiceService(deps: VoiceServiceDeps = {}) {
  await t.ctx.services.voice?.shutdown();
  const log = pino({ level: 'info' }, { write: (line: string) => void lines.push(line) });
  const service = createVoiceService({ ...t.ctx, log }, { transcribe, ...deps });
  t.ctx.services.voice = service;
  return service;
}
const modelDir = () => join(t.ctx.config.dataDir, 'models', 'whisper-small');
function installModel() {
  mkdirSync(modelDir(), { recursive: true });
  for (const [name, bytes] of Object.entries(MODEL)) writeFileSync(join(modelDir(), name), bytes);
}
const saveApiKey = () =>
  t.ctx.services.ai!.saveConnection({ mode: 'api', model: '', apiKey: 'sk-test-key-123' }, actor);

function voiceNote(id: string, bytes: Buffer = TONE, source: 'live' | 'history' = 'live') {
  return getMessages(t.ctx).ingest(
    {
      id,
      chatJid: jid,
      body: null,
      type: 'audio',
      fromMe: false,
      senderJid: jid,
      senderName: 'Customer',
      timestamp: Date.now(),
      quotedId: null,
      media: { mime: 'audio/ogg; codecs=opus', fileName: null, download: async () => bytes },
    },
    source,
  );
}
const stored = (id: string) =>
  getMessages(t.ctx)
    .list(jid, { limit: 50 })
    .messages.find((m) => m.id === id);
const api = (method: 'GET' | 'PATCH' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: authHeaders(cookie), ...(payload ? { payload } : {}) });

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
  lines = [];
  transcribe = vi.fn<NonNullable<VoiceServiceDeps['transcribe']>>(async () => ({
    text: ` ${TRANSCRIPT} `,
    lang: 'en',
  }));
});
afterEach(async () => {
  await t.close();
});

describe('voice note transcription', () => {
  it('transcribes a live voice note with the chosen engine and updates open inboxes', async () => {
    saveApiKey();
    const voice = await voiceService();
    voice.setTranscription('cloud', actor);
    const updates: Message[] = [];
    t.ctx.bus.on('message:updated', (m) => updates.push(m));
    const message = await voiceNote('voice-1');
    // Marked before message:new, so the inbox can show "Transcribing…" immediately.
    expect(message?.transcriptStatus).toBe('pending');
    await voice.idle();
    expect(transcribe).toHaveBeenCalledWith(
      'cloud',
      expect.any(Uint8Array),
      expect.objectContaining({ mime: 'audio/ogg', extension: 'ogg' }),
    );
    expect(stored('voice-1')).toMatchObject({
      transcript: TRANSCRIPT,
      transcriptLang: 'en',
      transcriptStatus: 'ok',
    });
    expect(updates.map((m) => [m.id, m.transcriptStatus])).toEqual([['voice-1', 'ok']]);
    const res = await api('GET', `/api/chats/${encodeURIComponent(jid)}/messages`);
    expect(res.json().messages[0]).toMatchObject({
      transcript: TRANSCRIPT,
      transcriptStatus: 'ok',
    });
    // Transcripts are customer data: only the outcome is logged.
    const log = lines.join('\n');
    expect(log).toContain('voice_transcribed');
    expect(log).not.toContain('Penang');
  });

  it('leaves voice notes alone when transcription is off and never transcribes history', async () => {
    const voice = await voiceService();
    expect((await voiceNote('off'))?.transcriptStatus).toBeUndefined();
    saveApiKey();
    voice.setTranscription('cloud', actor);
    expect((await voiceNote('old', TONE, 'history'))?.transcriptStatus).toBeUndefined();
    await voice.idle();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('records why a voice note has no transcript', async () => {
    saveApiKey();
    const voice = await voiceService();
    voice.setTranscription('cloud', actor);

    // Longer than 120 s by its Ogg granule position (no decoding needed).
    const long = Buffer.from(TONE);
    const last = long.lastIndexOf(Buffer.from('OggS'));
    long.writeBigInt64LE(BigInt(48_000 * 200), last + 6);
    await voiceNote('long', long);
    // Larger than 10 MB.
    await voiceNote('large', Buffer.concat([TONE, Buffer.alloc(10 * 1024 * 1024)]));
    // Not an audio format the cloud accepts.
    await voiceNote('odd', Buffer.from('not audio at all'));
    await voice.idle();
    expect(stored('long')?.transcriptStatus).toBe('too_long');
    expect(stored('large')?.transcriptStatus).toBe('too_long');
    expect(stored('odd')?.transcriptStatus).toBe('unsupported');

    transcribe.mockRejectedValueOnce(Object.assign(new Error('HTTP 500'), { status: 500 }));
    await voiceNote('broken');
    await voice.idle();
    expect(stored('broken')?.transcriptStatus).toBe('failed');
    expect(stored('broken')?.transcript).toBeNull();

    // The API key was removed after choosing cloud: the engine is not ready.
    t.ctx.settings.setSecret(AI_SECRET_KEY, null);
    expect((await voiceNote('no-key'))?.transcriptStatus).toBe('skipped');
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('transcribes at most 12 voice notes a minute per chat', async () => {
    saveApiKey();
    const voice = await voiceService();
    voice.setTranscription('cloud', actor);
    for (let n = 1; n <= 13; n++) await voiceNote(`v${n}`);
    await voice.idle();
    expect(stored('v12')?.transcriptStatus).toBe('ok');
    expect(stored('v13')?.transcriptStatus).toBe('skipped');
    expect(transcribe).toHaveBeenCalledTimes(12);
  });

  it('accepts only Ogg/Opus on this PC', async () => {
    installModel();
    const voice = await voiceService({ model: { files: MODEL_FILES } });
    voice.setTranscription('local', actor);
    await voiceNote('mp3', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]));
    await voiceNote('ogg');
    await voice.idle();
    expect(stored('mp3')?.transcriptStatus).toBe('unsupported');
    expect(stored('ogg')?.transcriptStatus).toBe('ok');
    expect(transcribe).toHaveBeenCalledWith(
      'local',
      expect.any(Uint8Array),
      expect.objectContaining({ paths: expect.objectContaining({ tokens: expect.any(String) }) }),
    );
  });

  it('shows jobs interrupted by a restart as failed', async () => {
    saveApiKey();
    const voice = await voiceService();
    voice.setTranscription('cloud', actor);
    await voiceNote('interrupted', Buffer.from('x'));
    t.ctx.db
      .prepare("UPDATE messages SET transcript_status = 'pending' WHERE id = 'interrupted'")
      .run();
    await voiceService();
    expect(stored('interrupted')?.transcriptStatus).toBe('failed');
  });
});

describe('voice settings routes', () => {
  it('reports status and allows each engine only when it can run', async () => {
    await voiceService();
    const initial = (await api('GET', '/api/ai/voice')).json() as VoiceStatus;
    expect(initial).toMatchObject({
      transcription: 'off',
      cloudAvailable: false,
      model: { state: 'not_installed', error: null },
    });
    expect((await api('PATCH', '/api/ai/voice', { transcription: 'local' })).statusCode).toBe(400);
    expect((await api('PATCH', '/api/ai/voice', { transcription: 'cloud' })).statusCode).toBe(400);
    expect((await api('PATCH', '/api/ai/voice', { transcription: 'loud' })).statusCode).toBe(400);
    saveApiKey();
    const events: VoiceStatus[] = [];
    t.ctx.bus.on('voice:status', (s) => events.push(s));
    const res = await api('PATCH', '/api/ai/voice', { transcription: 'cloud' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ transcription: 'cloud', cloudAvailable: true });
    expect(events.at(-1)?.transcription).toBe('cloud');
    // ChatGPT sign-in cannot transcribe: cloud is unavailable outside API-key mode.
    t.ctx.services.ai!.saveConnection({ mode: 'chatgpt', model: '' }, actor);
    expect((await api('GET', '/api/ai/voice')).json().cloudAvailable).toBe(false);
  });

  it('downloads the model, turns local transcription on, and removes it again', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const name = String(input).split('/').at(-1)!;
      return new Response(new Uint8Array(MODEL[name]!), { status: 200 });
    });
    await voiceService({
      model: { files: MODEL_FILES, fetch, freeBytes: async () => 10 * 1024 ** 3 },
    });
    const started = await api('POST', '/api/ai/voice/download');
    expect(started.statusCode).toBe(200);
    await vi.waitFor(async () =>
      expect((await api('GET', '/api/ai/voice')).json().model.state).toBe('installed'),
    );
    expect((await api('GET', '/api/ai/voice')).json().transcription).toBe('local');
    const removed = await api('DELETE', '/api/ai/voice/model');
    expect(removed.json()).toMatchObject({
      transcription: 'off',
      model: { state: 'not_installed' },
    });
    const audit = t.ctx.db
      .prepare("SELECT action FROM audit_log WHERE action LIKE 'ai.voice%'")
      .all();
    expect(audit).toEqual([
      { action: 'ai.voice_model_download' },
      { action: 'ai.voice_model_remove' },
    ]);
  });

  it('rate-limits download starts', async () => {
    await voiceService({ model: { freeBytes: async () => 0 } });
    const codes: number[] = [];
    for (let n = 0; n < 6; n++)
      codes.push((await api('POST', '/api/ai/voice/download')).statusCode);
    expect(codes.slice(0, 5).every((code) => code === 200)).toBe(true);
    expect(codes[5]).toBe(429);
    await vi.waitFor(async () =>
      expect((await api('GET', '/api/ai/voice')).json().model).toMatchObject({
        state: 'error',
        error: 'disk_space',
      }),
    );
    expect((await api('POST', '/api/ai/voice/cancel')).statusCode).toBe(200);
  });
});
