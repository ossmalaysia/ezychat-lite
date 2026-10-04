import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { errors } from '../http/errors.js';

/** Isolate document parser CPU/memory from the inbox and bound hostile/malformed inputs. */
export function extractKnowledgeIsolated(name: string, buffer: Buffer): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const compiled = [join(here, 'ai-document-worker.cjs'), join(here, 'document-worker.js')].find(
    existsSync,
  );
  const entry = compiled ?? join(here, 'document-worker.ts');
  return new Promise((resolve, reject) => {
    const worker = new Worker(entry, {
      workerData: { name, buffer },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
      // Source dev/tests register TypeScript explicitly; packaged workers are plain CommonJS.
      execArgv: compiled ? [] : ['--import', 'tsx'],
      stdout: true,
      stderr: true,
    });
    let settled = false;
    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(text!);
    };
    const timer = setTimeout(
      () => finish(errors.validation('Document parsing timed out. Try a smaller document.')),
      15_000,
    );
    worker.on('message', (result: { text?: string; error?: string }) =>
      result.error
        ? finish(errors.validation(result.error))
        : typeof result.text === 'string'
          ? finish(undefined, result.text)
          : finish(errors.validation('Cannot read this document')),
    );
    worker.on('error', () => finish(errors.validation('Cannot read this document')));
    worker.on('exit', () => {
      if (!settled) finish(errors.validation('Cannot read this document'));
    });
    // Consume parser diagnostics without logging document contents or paths.
    worker.stdout?.resume();
    worker.stderr?.resume();
  });
}
