// Minimal types for the parts of sherpa-onnx-node (CommonJS, no bundled .d.ts) the voice worker uses.
declare module 'sherpa-onnx-node' {
  export interface OfflineStream {
    acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void;
  }
  export interface OfflineRecognizerResult {
    text: string;
    lang?: string;
  }
  export class OfflineRecognizer {
    constructor(config: Record<string, unknown>);
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): OfflineRecognizerResult;
  }
  const sherpa: { OfflineRecognizer: typeof OfflineRecognizer };
  export default sherpa;
}
