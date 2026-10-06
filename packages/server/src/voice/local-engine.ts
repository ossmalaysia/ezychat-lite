import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  TranscribeError,
  type TranscribeFailure,
  type TranscriptResult,
  type VoiceModelPaths,
} from './recognizer.js';

/** The parts of a worker_threads Worker the engine uses (a fake in tests). */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
  on(event: 'message', listener: (message: WorkerReply) => void): unknown;
  on(event: 'error' | 'exit', listener: (value: unknown) => void): unknown;
  terminate(): Promise<number>;
}
export type WorkerReply =
  ({ id: number } & TranscriptResult) | { id: number; error: TranscribeFailure };

export function voiceThreads(): number {
  return Math.max(1, Math.min(4, availableParallelism() - 1));
}

/**
 * Starts the transcription worker. Bundled builds ship `voice-transcribe-worker.cjs` next to
 * server.cjs (scripts/bundle-server.mjs); source runs (dev, tests) load the TypeScript entry
 * through tsx, like the document worker.
 */
export function spawnTranscribeWorker(paths: VoiceModelPaths): WorkerLike {
  const here = dirname(fileURLToPath(import.meta.url));
  const compiled = [
    join(here, 'voice-transcribe-worker.cjs'),
    join(here, 'transcribe-worker.js'),
  ].find(existsSync);
  const worker = new Worker(compiled ?? join(here, 'transcribe-worker.ts'), {
    workerData: { paths, numThreads: voiceThreads() },
    execArgv: compiled ? [] : ['--import', 'tsx'],
    stdout: true,
    stderr: true,
  });
  // Native diagnostics are consumed, never logged (they could include file paths).
  worker.stdout.resume();
  worker.stderr.resume();
  return worker as unknown as WorkerLike;
}

interface Pending {
  resolve(result: TranscriptResult): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One long-lived worker, created on the first job, model loaded once inside it. Jobs run one at
 * a time; a crashed or timed-out worker is replaced on the next job.
 */
export class LocalEngine {
  private worker: WorkerLike | null = null;
  private workerPaths: string | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: {
      spawn?: (paths: VoiceModelPaths) => WorkerLike;
      /** Per job (model load + decoding of up to 120 s of audio). */
      timeoutMs?: number;
    } = {},
  ) {}

  transcribe(paths: VoiceModelPaths, audio: Uint8Array): Promise<TranscriptResult> {
    const run = this.tail.then(() => this.run(paths, audio));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private ensureWorker(paths: VoiceModelPaths): WorkerLike {
    const key = JSON.stringify(paths);
    if (this.worker && this.workerPaths === key) return this.worker;
    this.stopWorker();
    const worker = (this.options.spawn ?? spawnTranscribeWorker)(paths);
    this.worker = worker;
    this.workerPaths = key;
    worker.on('message', (reply: WorkerReply) => {
      const job = this.pending.get(reply.id);
      if (!job) return;
      this.pending.delete(reply.id);
      clearTimeout(job.timer);
      if ('error' in reply) job.reject(new TranscribeError(reply.error));
      else job.resolve({ text: reply.text, lang: reply.lang });
    });
    const lost = () => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.workerPaths = null;
      this.failAll('recognize');
    };
    worker.on('error', lost);
    worker.on('exit', lost);
    return worker;
  }

  private run(paths: VoiceModelPaths, audio: Uint8Array): Promise<TranscriptResult> {
    const worker = this.ensureWorker(paths);
    const id = this.nextId++;
    return new Promise<TranscriptResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TranscribeError('recognize'));
        // A stuck decode cannot be interrupted: replace the worker.
        this.stopWorker();
      }, this.options.timeoutMs ?? 180_000);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      // Copy into a transferable buffer (the caller's buffer may be a pooled Node Buffer).
      const copy = new Uint8Array(audio);
      worker.postMessage({ id, audio: copy }, [copy.buffer]);
    });
  }

  private failAll(reason: TranscribeFailure) {
    for (const [id, job] of this.pending) {
      clearTimeout(job.timer);
      job.reject(new TranscribeError(reason));
      this.pending.delete(id);
    }
  }

  private stopWorker() {
    const worker = this.worker;
    this.worker = null;
    this.workerPaths = null;
    this.failAll('recognize');
    if (worker) void worker.terminate().catch(() => undefined);
  }

  /** Terminates the worker (model removed, shutdown). */
  shutdown() {
    this.stopWorker();
  }
}
