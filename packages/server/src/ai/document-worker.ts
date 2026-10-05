import { parentPort, workerData } from 'node:worker_threads';
import { extractKnowledge } from './knowledge.js';

void (async () => {
  try {
    const { name, buffer } = workerData as { name: string; buffer: Uint8Array };
    const text = await extractKnowledge(name, Buffer.from(buffer));
    parentPort!.postMessage({ text });
  } catch (error) {
    parentPort!.postMessage({
      error:
        error instanceof Error && error.name === 'HttpError'
          ? error.message
          : 'Cannot read this document',
    });
  }
})();
