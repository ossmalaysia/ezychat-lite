import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import {
  VoiceTranscription,
  type TranscriptStatus,
  type VoiceModelStatus,
  type VoiceStatus,
} from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { errors } from '../http/errors.js';
import { openAiApiKey } from '../ai/settings-keys.js';
import { MessageRepo, rowToMessage } from '../messages/repo.js';
import { getMessages } from '../wa-bridge/index.js';
import { VOICE_MAX_SECONDS, isOgg, oggOpusDurationSeconds } from './audio.js';
import { CLOUD_AUDIO_EXTENSIONS, transcribeCloud } from './cloud-engine.js';
import { LocalEngine, type WorkerLike } from './local-engine.js';
import { VoiceModelManager, type VoiceModelManagerOptions } from './model.js';
import type { TranscriptResult, VoiceModelPaths } from './recognizer.js';

/** Setting key of the chosen engine (`off` | `local` | `cloud`). */
export const VOICE_SETTING = 'voice_transcription';
/** Longer voice notes are not transcribed. */
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_MAX_TRANSCRIPT_CHARACTERS = 4000;
/** Per chat, in memory: at most this many transcriptions per minute. */
export const VOICE_PER_CHAT_PER_MINUTE = 12;
/** Queued jobs beyond this are skipped (a burst must not pile up unbounded work). */
const VOICE_MAX_QUEUE = 50;

type Actor = { userId: number; ip: string | null };
type Engine = 'local' | 'cloud';

export interface VoiceService {
  status(): VoiceStatus;
  setTranscription(value: VoiceTranscription, actor: Actor): VoiceStatus;
  startDownload(actor: Actor): VoiceStatus;
  cancelDownload(actor: Actor): Promise<VoiceStatus>;
  removeModel(actor: Actor): Promise<VoiceStatus>;
  /**
   * A live inbound audio file was stored. Marks it `pending` (or why it is skipped) synchronously,
   * before `message:new` is emitted, and queues the transcription.
   */
  onAudioStored(messageId: string): void;
  /** Resolves when the message's transcript is no longer pending, or after `ms`, or on abort. */
  waitForTranscript(messageId: string, signal: AbortSignal, ms: number): Promise<void>;
  /** Settles when every queued job has finished (tests). */
  idle(): Promise<void>;
  shutdown(): Promise<void>;
}

declare module '../context.js' {
  interface Services {
    voice?: VoiceService;
  }
}

export interface VoiceServiceDeps {
  model?: Partial<VoiceModelManagerOptions>;
  spawnWorker?: (paths: VoiceModelPaths) => WorkerLike;
  /** Replaces both engines (tests). */
  transcribe?: (
    engine: Engine,
    audio: Uint8Array,
    file: { mime: string; extension: string | null; paths: VoiceModelPaths | null },
  ) => Promise<TranscriptResult>;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export function createVoiceService(ctx: AppContext, deps: VoiceServiceDeps = {}): VoiceService {
  const log = ctx.log.child({ mod: 'voice' });
  const repo = new MessageRepo(ctx.db);
  const now = deps.now ?? Date.now;
  const local = new LocalEngine(deps.spawnWorker ? { spawn: deps.spawnWorker } : {});
  const recent = new Map<string, number[]>();
  let queued = 0;
  let tail: Promise<void> = Promise.resolve();
  let closed = false;

  const transcription = (): VoiceTranscription => {
    const parsed = VoiceTranscription.safeParse(ctx.settings.get<unknown>(VOICE_SETTING, 'off'));
    return parsed.success ? parsed.data : 'off';
  };

  let previousModelState: VoiceModelStatus['state'] | null = null;
  const model = new VoiceModelManager({
    dir: join(ctx.config.dataDir, 'models', 'whisper-small'),
    log,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...deps.model,
    onChange: (next) => {
      // A finished install turns transcription on locally unless an engine was already chosen.
      if (
        previousModelState === 'downloading' &&
        next.state === 'installed' &&
        transcription() === 'off'
      )
        ctx.settings.set(VOICE_SETTING, 'local');
      previousModelState = next.state;
      if (!closed) ctx.bus.emit('voice:status', status());
    },
  });

  const status = (): VoiceStatus => ({
    transcription: transcription(),
    model: model.status(),
    cloudAvailable: !!openAiApiKey(ctx.settings),
  });

  /** The engine that can run now, or null (off, model missing, no API key). */
  const readyEngine = (): Engine | null => {
    const chosen = transcription();
    if (chosen === 'local') return model.paths() ? 'local' : null;
    if (chosen === 'cloud') return openAiApiKey(ctx.settings) ? 'cloud' : null;
    return null;
  };

  const store = (
    id: string,
    transcriptStatus: TranscriptStatus,
    result?: TranscriptResult,
    emit = true,
  ) => {
    repo.update(id, {
      transcript_status: transcriptStatus,
      transcript: transcriptStatus === 'ok' ? (result?.text.trim() ?? null) : null,
      transcript_lang: transcriptStatus === 'ok' ? (result?.lang ?? null) : null,
    });
    const row = repo.get(id);
    if (!emit || !row) return;
    const msg = rowToMessage(row);
    // Keep a group sender's customer profile name on the updated message.
    ctx.bus.emit('message:updated', ctx.services.customers?.withSenderProfiles([msg])[0] ?? msg);
  };

  const throttled = (chatJid: string): boolean => {
    const t = now();
    const times = (recent.get(chatJid) ?? []).filter((at) => t - at < 60_000);
    if (times.length >= VOICE_PER_CHAT_PER_MINUTE) {
      recent.set(chatJid, times);
      return true;
    }
    times.push(t);
    recent.set(chatJid, times);
    // Bounded memory: forget idle chats.
    if (recent.size > 1000)
      for (const [jid, list] of recent) if (!list.some((at) => t - at < 60_000)) recent.delete(jid);
    return false;
  };

  const extensionOf = async (bytes: Uint8Array): Promise<string | null> => {
    if (isOgg(bytes)) return 'ogg';
    const type = await fileTypeFromBuffer(bytes).catch(() => undefined);
    const ext = type?.ext === 'opus' || type?.ext === 'oga' ? 'ogg' : type?.ext;
    return ext && CLOUD_AUDIO_EXTENSIONS.includes(ext) ? ext : null;
  };

  const run = async (engine: Engine, audio: Uint8Array, mime: string, extension: string | null) => {
    if (deps.transcribe)
      return deps.transcribe(engine, audio, { mime, extension, paths: model.paths() });
    if (engine === 'local') return local.transcribe(model.paths()!, audio);
    return transcribeCloud({
      apiKey: openAiApiKey(ctx.settings)!,
      audio,
      extension: extension!,
      mime,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
  };

  const job = async (id: string) => {
    const started = now();
    const engine = readyEngine();
    if (!engine) return store(id, 'skipped');
    const file = getMessages(ctx).mediaPath(id);
    if (!file) return store(id, 'failed');
    let audio: Buffer;
    try {
      // Synchronous like the media store (at most 10 MB); checked by size before reading.
      if (statSync(file.path).size > VOICE_MAX_BYTES) return store(id, 'too_long');
      audio = readFileSync(file.path);
    } catch {
      return store(id, 'failed');
    }
    if (audio.length > VOICE_MAX_BYTES) return store(id, 'too_long');
    // Only Ogg/Opus (what WhatsApp voice notes are) is transcribed, by either engine: its length can
    // be checked before any work or cloud charge. Other audio files (songs, m4a/mp3 attachments) are
    // not voice notes and their length cannot be validated cheaply.
    const seconds = oggOpusDurationSeconds(audio);
    if (seconds === null) return store(id, 'unsupported');
    if (seconds > VOICE_MAX_SECONDS) return store(id, 'too_long');
    const extension = await extensionOf(audio);
    if (extension !== 'ogg') return store(id, 'unsupported');
    try {
      const raw = await run(engine, audio, file.mime.split(';')[0]!.trim(), extension);
      // Two minutes of speech is about 2,000 characters; cap what an engine can make us store.
      const result = { ...raw, text: raw.text.trim().slice(0, VOICE_MAX_TRANSCRIPT_CHARACTERS) };
      const ok = !!result.text;
      store(id, ok ? 'ok' : 'failed', result);
      // Never log transcript text or audio: only the outcome.
      log.info(
        {
          event: 'voice_transcribed',
          id,
          engine,
          status: ok ? 'ok' : 'empty',
          lang: result.lang,
          seconds: seconds === null ? null : Math.round(seconds),
          ms: now() - started,
        },
        'voice note transcribed',
      );
    } catch (error) {
      store(id, 'failed');
      log.warn(
        {
          event: 'voice_transcribe_failed',
          id,
          engine,
          reason: error instanceof Error ? error.name : 'unknown',
          status: (error as { status?: unknown }).status ?? null,
        },
        'voice note transcription failed',
      );
    }
  };

  // Jobs interrupted by a restart never finish: show them as failed instead of "Transcribing…".
  ctx.db
    .prepare("UPDATE messages SET transcript_status = 'failed' WHERE transcript_status = 'pending'")
    .run();
  model.init();
  previousModelState = model.status().state;
  if (transcription() === 'local' && !model.paths()) ctx.settings.set(VOICE_SETTING, 'off');

  const service: VoiceService = {
    status,
    setTranscription(value, actor) {
      if (value === 'local' && !model.paths())
        throw errors.validation('Download the voice model before choosing On this PC');
      if (value === 'cloud' && !openAiApiKey(ctx.settings))
        throw errors.validation('Cloud transcription needs an OpenAI API key in AI settings');
      ctx.settings.set(VOICE_SETTING, value);
      audit(ctx.db, { ...actor, action: 'ai.voice_update', meta: { transcription: value } });
      const next = status();
      ctx.bus.emit('voice:status', next);
      return next;
    },
    startDownload(actor) {
      if (model.status().state !== 'downloading' && model.status().state !== 'installed')
        audit(ctx.db, { ...actor, action: 'ai.voice_model_download', meta: {} });
      model.start();
      return status();
    },
    async cancelDownload(actor) {
      if (model.status().state === 'downloading')
        audit(ctx.db, { ...actor, action: 'ai.voice_model_cancel', meta: {} });
      await model.cancel();
      return status();
    },
    async removeModel(actor) {
      local.shutdown();
      await model.remove();
      if (transcription() === 'local') ctx.settings.set(VOICE_SETTING, 'off');
      audit(ctx.db, { ...actor, action: 'ai.voice_model_remove', meta: {} });
      const next = status();
      ctx.bus.emit('voice:status', next);
      return next;
    },
    onAudioStored(id) {
      if (closed || transcription() === 'off') return;
      const row = repo.get(id);
      if (!row || row.from_me || row.type !== 'audio' || row.media_status !== 'ok') return;
      if (!readyEngine() || throttled(row.chat_jid) || queued >= VOICE_MAX_QUEUE) {
        store(id, 'skipped', undefined, false);
        return;
      }
      store(id, 'pending', undefined, false);
      queued++;
      tail = tail
        .then(() => (closed ? store(id, 'failed') : job(id)))
        .catch(() => undefined)
        .finally(() => {
          queued--;
        });
    },
    waitForTranscript(id, signal, ms) {
      return new Promise<void>((resolve) => {
        const pending = () => repo.get(id)?.transcript_status === 'pending';
        const done = () => {
          clearTimeout(timer);
          ctx.bus.off('message:updated', onUpdated);
          signal.removeEventListener('abort', done);
          resolve();
        };
        const onUpdated = (message: { id: string }) => {
          if (message.id === id && !pending()) done();
        };
        const timer = setTimeout(done, ms);
        timer.unref?.();
        ctx.bus.on('message:updated', onUpdated);
        signal.addEventListener('abort', done, { once: true });
        if (!pending() || signal.aborted) done();
      });
    },
    idle: () => tail,
    async shutdown() {
      closed = true;
      local.shutdown();
      await model.cancel();
    },
  };
  return service;
}

export function initVoice(ctx: AppContext) {
  ctx.services.voice = createVoiceService(ctx);
}
