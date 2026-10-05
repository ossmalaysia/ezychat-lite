import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_NOTE_MAX_SECONDS } from '@wa-team-inbox/shared';

/**
 * Recording formats we can send as a WhatsApp voice note, in order of preference. Firefox records
 * OGG/Opus directly; Chrome and Edge record WebM/Opus, which the server remuxes to OGG without
 * re-encoding. Safari records only MP4/AAC, which would need transcoding, so it is unsupported.
 */
export const VOICE_RECORDING_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus'] as const;

const MIN_MS = 1_000;
const MAX_MS = VOICE_NOTE_MAX_SECONDS * 1000;
const TICK_MS = 200;
/** Opus speech quality; keeps five minutes well under the upload cap. */
const BITS_PER_SECOND = 32_000;

export type VoiceSupport = 'ok' | 'insecure' | 'unsupported';
export type VoiceError = 'denied' | 'no-mic' | 'failed' | 'too-short';

export interface VoiceRecording {
  blob: Blob;
  mime: string;
  seconds: number;
  /** object URL for listening back; revoked by take()/cancel() */
  url: string;
}

export type VoiceRecorderState =
  | { status: 'idle'; error?: VoiceError }
  | { status: 'starting' }
  | { status: 'recording'; elapsedMs: number }
  | { status: 'review'; recording: VoiceRecording };

export function voiceRecordingMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder) return null;
  try {
    return VOICE_RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
  } catch {
    return null;
  }
}

/** Whether this browser can record a voice note here (the microphone needs HTTPS or localhost). */
export function voiceSupport(): VoiceSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (window.isSecureContext === false) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  return voiceRecordingMime() ? 'ok' : 'unsupported';
}

function errorFor(err: unknown): VoiceError {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-mic';
  return 'failed';
}

interface Session {
  stream: { getTracks(): Array<{ stop(): void }> } | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  startedAt: number;
  timer: ReturnType<typeof setInterval> | null;
  discard: boolean;
  /** start() superseded by cancel()/unmount before the microphone answered */
  aborted: boolean;
}

function release(s: Session): void {
  if (s.timer) clearInterval(s.timer);
  s.timer = null;
  for (const track of s.stream?.getTracks() ?? []) track.stop();
  s.stream = null;
}

/** Abandons a session synchronously, so start() can begin a new one immediately. */
function abandon(s: Session, session: { current: Session | null }): void {
  s.discard = true;
  s.aborted = true;
  if (session.current === s) session.current = null;
  if (s.recorder && s.recorder.state !== 'inactive') s.recorder.stop(); // its late stop event is ignored
  release(s);
}

/**
 * Voice-note recorder state machine:
 * idle → starting (permission) → recording (timer, auto-stop at 5 min) → review (listen back)
 * → take() (send) or cancel(). Errors return to idle with a reason.
 */
export function useVoiceRecorder() {
  const [state, setState] = useState<VoiceRecorderState>({ status: 'idle' });
  const session = useRef<Session | null>(null);
  const review = useRef<VoiceRecording | null>(null);
  const mounted = useRef(true);

  const set = (next: VoiceRecorderState) => {
    if (mounted.current) setState(next);
  };

  const stop = useCallback(() => {
    const s = session.current;
    if (!s?.recorder || s.recorder.state === 'inactive') return;
    s.recorder.stop();
  }, []);

  const start = useCallback(() => {
    if (session.current) return;
    const mime = voiceRecordingMime();
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      set({ status: 'idle', error: 'failed' });
      return;
    }
    const s: Session = {
      stream: null,
      recorder: null,
      chunks: [],
      startedAt: 0,
      timer: null,
      discard: false,
      aborted: false,
    };
    session.current = s;
    set({ status: 'starting' });
    navigator.mediaDevices
      .getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      .then((stream) => {
        s.stream = stream;
        if (s.aborted) {
          release(s);
          return;
        }
        const recorder = new MediaRecorder(stream, {
          mimeType: mime,
          audioBitsPerSecond: BITS_PER_SECOND,
        });
        s.recorder = recorder;
        recorder.ondataavailable = (e: BlobEvent | { data: Blob }) => {
          if (e.data && e.data.size > 0) s.chunks.push(e.data);
        };
        recorder.onstop = () => {
          const elapsed = Math.min(Date.now() - s.startedAt, MAX_MS);
          release(s);
          if (session.current === s) session.current = null;
          // cancelled: cancel() already reset the state, and a new session may be running
          if (s.discard) return;
          if (elapsed < MIN_MS) {
            set({ status: 'idle', error: 'too-short' });
            return;
          }
          const type = recorder.mimeType || mime;
          const blob = new Blob(s.chunks, { type });
          const recording: VoiceRecording = {
            blob,
            mime: type,
            seconds: elapsed / 1000,
            url: URL.createObjectURL(blob),
          };
          review.current = recording;
          if (mounted.current) setState({ status: 'review', recording });
          else URL.revokeObjectURL(recording.url);
        };
        recorder.onerror = () => {
          if (s.discard) return;
          s.discard = true;
          release(s);
          if (session.current === s) session.current = null;
          set({ status: 'idle', error: 'failed' });
        };
        s.startedAt = Date.now();
        recorder.start(1000);
        set({ status: 'recording', elapsedMs: 0 });
        s.timer = setInterval(() => {
          const elapsedMs = Date.now() - s.startedAt;
          if (elapsedMs >= MAX_MS) {
            if (recorder.state !== 'inactive') recorder.stop();
            return;
          }
          set({ status: 'recording', elapsedMs });
        }, TICK_MS);
      })
      .catch((err: unknown) => {
        if (session.current === s) session.current = null;
        release(s);
        if (!s.aborted) set({ status: 'idle', error: errorFor(err) });
      });
  }, []);

  const clearReview = () => {
    if (review.current) URL.revokeObjectURL(review.current.url);
    review.current = null;
  };

  const cancel = useCallback(() => {
    const s = session.current;
    if (s) abandon(s, session);
    clearReview();
    set({ status: 'idle' });
  }, []);

  /** Hands the reviewed recording to the caller (to send) and resets. */
  const take = useCallback((): VoiceRecording | null => {
    const r = review.current;
    clearReview();
    set({ status: 'idle' });
    return r;
  }, []);

  /** Clears an error message. */
  const dismiss = useCallback(() => {
    setState((cur) => (cur.status === 'idle' && cur.error ? { status: 'idle' } : cur));
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const s = session.current;
      if (s) abandon(s, session);
      clearReview();
    };
  }, []);

  return { state, start, stop, cancel, take, dismiss };
}
