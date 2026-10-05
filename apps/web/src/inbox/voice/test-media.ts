/* Test doubles for getUserMedia + MediaRecorder (jsdom has neither). Used by recorder and Composer tests. */
import { vi } from 'vitest';

export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supported: string[] = ['audio/webm;codecs=opus'];
  /** like real browsers: deliver the data and `stop` event on a later task */
  static asyncStop = false;
  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.includes(type);
  }

  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly mimeType: string;

  constructor(
    readonly stream: unknown,
    readonly options: MediaRecorderOptions = {},
  ) {
    this.mimeType = options.mimeType ?? '';
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    const finish = () => {
      this.ondataavailable?.({ data: new Blob(['opus-bytes'], { type: this.mimeType }) });
      this.onstop?.();
    };
    if (FakeMediaRecorder.asyncStop) setTimeout(finish, 0);
    else finish();
  }
}

export interface MediaMocks {
  getUserMedia: ReturnType<typeof vi.fn>;
  trackStop: ReturnType<typeof vi.fn>;
  createObjectURL: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
}

/**
 * Installs the fakes. `supported` lists the MediaRecorder types the "browser" can record
 * (Safari: only audio/mp4). `secure: false` simulates plain-HTTP LAN access.
 */
export function installMediaMocks(
  o: { supported?: string[]; secure?: boolean; deny?: string } = {},
): MediaMocks {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.asyncStop = false;
  FakeMediaRecorder.supported = o.supported ?? ['audio/webm;codecs=opus'];
  const trackStop = vi.fn();
  const getUserMedia = vi.fn(async () => {
    if (o.deny) throw new DOMException('denied', o.deny);
    return { getTracks: () => [{ stop: trackStop }] };
  });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: o.secure ?? true,
  });
  const createObjectURL = vi.fn(() => 'blob:voice-preview');
  const revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  return { getUserMedia, trackStop, createObjectURL, revokeObjectURL };
}

export function removeMediaMocks(): void {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
}
