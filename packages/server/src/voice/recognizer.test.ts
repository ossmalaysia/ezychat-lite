import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalEngine, type WorkerLike, type WorkerReply } from './local-engine.js';
import {
  TranscribeError,
  createTranscribeHandler,
  normalizeLang,
  splitForWhisper,
  type Recognizer,
} from './recognizer.js';

const TONE = new Uint8Array(
  readFileSync(join(import.meta.dirname, '../../test/fixtures/tone-1s.ogg')),
);
const PATHS = { encoder: 'e.onnx', decoder: 'd.onnx', tokens: 't.txt' };

describe('transcribe handler (worker side, fake recognizer)', () => {
  it('decodes the voice note and passes 16 kHz mono samples to the recognizer once loaded', async () => {
    const seen: Array<[number, number]> = [];
    const recognizer: Recognizer = {
      transcribe: (samples, rate) => {
        seen.push([samples.length, rate]);
        return { text: ' Do you deliver to Penang? ', lang: '<|en|>' };
      },
    };
    const load = vi.fn(() => recognizer);
    const handle = createTranscribeHandler(load);
    expect(await handle(TONE)).toEqual({ text: 'Do you deliver to Penang?', lang: 'en' });
    await handle(TONE);
    expect(load).toHaveBeenCalledTimes(1);
    expect(seen[0]![1]).toBe(16_000);
    expect(seen[0]![0]).toBeGreaterThan(15_000);
  });

  it('reports decode and model failures by reason only', async () => {
    const handle = createTranscribeHandler(() => {
      throw new Error('C:/secret/path/model.onnx does not exist');
    });
    await expect(handle(new Uint8Array(10))).rejects.toMatchObject({ reason: 'decode' });
    const failure = await handle(TONE).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TranscribeError);
    expect((failure as TranscribeError).reason).toBe('model');
    expect((failure as Error).message).not.toContain('secret');
  });

  it('splits audio longer than a Whisper window and joins the chunk texts', async () => {
    const samples = new Float32Array(16_000 * 60).fill(0.5);
    const chunks = splitForWhisper(samples);
    expect(chunks.length).toBe(3);
    expect(chunks.every((chunk) => chunk.length <= 16_000 * 28)).toBe(true);
    expect(chunks.reduce((n, chunk) => n + chunk.length, 0)).toBe(samples.length);
    expect(splitForWhisper(new Float32Array(16_000))).toHaveLength(1);
    expect(normalizeLang('<|ms|>')).toBe('ms');
    expect(normalizeLang('<|zh|>')).toBe('zh');
    expect(normalizeLang('')).toBeNull();
    expect(normalizeLang(undefined)).toBeNull();
  });
});

/** A fake worker that answers each job when the test says so. */
function fakeWorker() {
  const emitter = new EventEmitter();
  const jobs: Array<{ id: number; audio: Uint8Array }> = [];
  const worker = {
    postMessage: vi.fn((message: { id: number; audio: Uint8Array }) => jobs.push(message)),
    on: (event: string, listener: (...args: unknown[]) => void) => emitter.on(event, listener),
    terminate: vi.fn(async () => {
      emitter.emit('exit', 1);
      return 1;
    }),
  };
  return {
    worker: worker as unknown as WorkerLike,
    jobs,
    reply: (message: WorkerReply) => emitter.emit('message', message),
    crash: () => emitter.emit('error', new Error('boom')),
    terminate: worker.terminate,
  };
}

describe('local engine (main side)', () => {
  it('starts one worker lazily and runs jobs one at a time', async () => {
    const fake = fakeWorker();
    const spawn = vi.fn(() => fake.worker);
    const engine = new LocalEngine({ spawn });
    expect(spawn).not.toHaveBeenCalled();
    const first = engine.transcribe(PATHS, new Uint8Array([1]));
    const second = engine.transcribe(PATHS, new Uint8Array([2]));
    await vi.waitFor(() => expect(fake.jobs).toHaveLength(1));
    fake.reply({ id: fake.jobs[0]!.id, text: 'one', lang: 'en' });
    expect(await first).toEqual({ text: 'one', lang: 'en' });
    await vi.waitFor(() => expect(fake.jobs).toHaveLength(2));
    fake.reply({ id: fake.jobs[1]!.id, error: 'decode' });
    await expect(second).rejects.toMatchObject({ reason: 'decode' });
    expect(spawn).toHaveBeenCalledTimes(1);
    engine.shutdown();
    expect(fake.terminate).toHaveBeenCalled();
  });

  it('replaces a crashed worker on the next job', async () => {
    const workers = [fakeWorker(), fakeWorker()];
    const spawn = vi.fn(() => workers[spawn.mock.calls.length - 1]!.worker);
    const engine = new LocalEngine({ spawn });
    const first = engine.transcribe(PATHS, new Uint8Array([1]));
    await vi.waitFor(() => expect(workers[0]!.jobs).toHaveLength(1));
    workers[0]!.crash();
    await expect(first).rejects.toBeInstanceOf(TranscribeError);
    const second = engine.transcribe(PATHS, new Uint8Array([2]));
    await vi.waitFor(() => expect(workers[1]!.jobs).toHaveLength(1));
    workers[1]!.reply({ id: workers[1]!.jobs[0]!.id, text: 'two', lang: null });
    expect(await second).toEqual({ text: 'two', lang: null });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('times out a stuck job and terminates the worker', async () => {
    const fake = fakeWorker();
    const engine = new LocalEngine({ spawn: () => fake.worker, timeoutMs: 20 });
    await expect(engine.transcribe(PATHS, new Uint8Array([1]))).rejects.toMatchObject({
      reason: 'recognize',
    });
    expect(fake.terminate).toHaveBeenCalled();
  });
});
