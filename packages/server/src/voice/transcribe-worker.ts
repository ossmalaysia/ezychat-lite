// Voice transcription worker: one long-lived thread owning the sherpa-onnx Whisper model, so
// CPU-heavy decoding never blocks the server's event loop. Bundled as voice-transcribe-worker.cjs.
import { parentPort, workerData } from 'node:worker_threads';
import sherpa from 'sherpa-onnx-node';
import {
  TranscribeError,
  createTranscribeHandler,
  type Recognizer,
  type VoiceModelPaths,
} from './recognizer.js';

const { paths, numThreads } = workerData as { paths: VoiceModelPaths; numThreads: number };

function loadWhisper(): Recognizer {
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      whisper: { encoder: paths.encoder, decoder: paths.decoder, language: '', task: 'transcribe' },
      tokens: paths.tokens,
      numThreads,
      provider: 'cpu',
      debug: 0,
    },
  });
  return {
    transcribe(samples, sampleRate) {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ sampleRate, samples });
      recognizer.decode(stream);
      const { text, lang } = recognizer.getResult(stream);
      return { text: typeof text === 'string' ? text : '', lang: lang ?? null };
    },
  };
}

const handle = createTranscribeHandler(loadWhisper);

parentPort!.on('message', (job: { id: number; audio: Uint8Array }) => {
  void handle(job.audio).then(
    (result) => parentPort!.postMessage({ id: job.id, ...result }),
    (error: unknown) =>
      parentPort!.postMessage({
        id: job.id,
        error: error instanceof TranscribeError ? error.reason : 'recognize',
      }),
  );
});
