import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

/** How long one preview may take before the worker is stopped. */
export const PREVIEW_TIMEOUT_MS = 15_000;

/** What the worker sends back: the preview, or why this file can never have one. */
export type PreviewResult = { jpeg: Uint8Array } | { skip: 'not_jpeg' | 'rotated' | 'unreadable' };

/** The worker file next to this module: compiled (package, bundle) or TypeScript source (dev, tests). */
function workerEntry(): { entry: string; compiled: boolean } | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const compiled = [
    join(here, 'image-preview-worker.cjs'),
    join(here, 'image-preview-worker.js'),
  ].find(existsSync);
  if (compiled) return { entry: compiled, compiled: true };
  const source = join(here, 'image-preview-worker.ts');
  return existsSync(source) ? { entry: source, compiled: false } : null;
}

/**
 * The app's own chat preview of a stored photo (WhatsApp's thumbnail is about 48 × 64 px): a JPEG of at
 * most 800 px on its long side, made in a worker thread that reads the file itself.
 * Resolves null when this file can never have one (not a JPEG, rotated by EXIF, unreadable, or no
 * worker in this build); rejects on a temporary failure (timeout, worker crash), so it may be asked again.
 */
export function makeImagePreview(path: string): Promise<Buffer | null> {
  const found = workerEntry();
  if (!found) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const worker = new Worker(found.entry, {
      workerData: { path },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
      // Source dev/tests register TypeScript explicitly; packaged workers are plain CommonJS.
      execArgv: found.compiled ? [] : ['--conditions=ezychat-source', '--import', 'tsx'],
      stdout: true,
      stderr: true,
    });
    let settled = false;
    const finish = (out: Buffer | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(out);
    };
    const timer = setTimeout(() => finish(null, new Error('timeout')), PREVIEW_TIMEOUT_MS);
    worker.on('message', (result: PreviewResult) =>
      finish('jpeg' in result ? Buffer.from(result.jpeg) : null),
    );
    worker.on('error', () => finish(null, new Error('worker_failed')));
    worker.on('exit', () => finish(null, new Error('worker_failed')));
    worker.stdout?.resume();
    worker.stderr?.resume();
  });
}
