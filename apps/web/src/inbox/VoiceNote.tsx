import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MicOff, Pause, Play, SendHorizontal, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  VOICE_NOTE_MAX_SECONDS,
  VoiceStartFailure,
  startVoiceRecording,
  type VoiceRecording,
  type VoiceStartError,
} from '@/lib/voice-recorder';

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'review' | VoiceStartError;

const LIVE_BARS = 48;
const REVIEW_BARS = 48;
const SAMPLE_MS = 100;

export const formatClock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** `levels` (0–1) squeezed or stretched into `n` bars. */
function toBars(levels: number[], n: number): number[] {
  if (!levels.length) return Array.from({ length: n }, () => 0);
  return Array.from({ length: n }, (_, i) => {
    const start = Math.floor((i * levels.length) / n);
    const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / n));
    const slice = levels.slice(start, end);
    return Math.max(...slice);
  });
}

interface Review {
  blob: Blob;
  url: string;
  seconds: number;
  bars: number[];
}

/** Record → (review) → send a voice note. `send` gets the Ogg/Opus file. */
export function useVoiceNote(send: (file: File) => void | Promise<void>) {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const recording = useRef<VoiceRecording | null>(null);
  const levels = useRef<number[]>([]);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const clearReview = useCallback(() => {
    setReview((r) => {
      if (r) URL.revokeObjectURL(r.url);
      return null;
    });
  }, []);

  const finish = useCallback(async (): Promise<Review | null> => {
    const rec = recording.current;
    recording.current = null;
    stopTimer();
    if (!rec) return null;
    const blob = await rec.stop();
    // Whole seconds, rounded down like the audio player that plays it back.
    const secs = Math.max(1, Math.floor((Date.now() - started.current) / 1000));
    return {
      blob,
      url: URL.createObjectURL(blob),
      seconds: secs,
      bars: toBars(levels.current, REVIEW_BARS),
    };
  }, []);

  const toReview = useCallback(async () => {
    const r = await finish();
    if (!r) return;
    setReview(r);
    setPhase('review');
  }, [finish]);

  // Called from the mic button's click: the browser only starts audio from a user action.
  const start = useCallback(async () => {
    setPhase('starting');
    try {
      recording.current = await startVoiceRecording();
    } catch (err) {
      setPhase(err instanceof VoiceStartFailure ? err.reason : 'failed');
      return;
    }
    levels.current = [];
    started.current = Date.now();
    setSeconds(0);
    setLive([]);
    setPhase('recording');
    timer.current = setInterval(() => {
      const rec = recording.current;
      if (!rec) return;
      levels.current.push(rec.level());
      setLive(levels.current.slice(-LIVE_BARS));
      const elapsed = (Date.now() - started.current) / 1000;
      setSeconds(Math.floor(elapsed));
      if (elapsed >= VOICE_NOTE_MAX_SECONDS) void toReview();
    }, SAMPLE_MS);
  }, [toReview]);

  const discard = useCallback(() => {
    stopTimer();
    recording.current?.cancel();
    recording.current = null;
    clearReview();
    setPhase('idle');
  }, [clearReview]);

  const deliver = useCallback(
    async (r: Review | null) => {
      if (!r) return;
      setPhase('idle');
      clearReview();
      URL.revokeObjectURL(r.url);
      await send(new File([r.blob], 'voice-note.ogg', { type: 'audio/ogg' }));
    },
    [clearReview, send],
  );

  const sendNow = useCallback(async () => deliver(await finish()), [deliver, finish]);
  const sendReviewed = useCallback(() => deliver(review), [deliver, review]);

  // Leaving the chat mid-recording stops the microphone and drops the recording.
  useEffect(
    () => () => {
      stopTimer();
      recording.current?.cancel();
    },
    [],
  );
  useEffect(
    () => () => {
      if (review) URL.revokeObjectURL(review.url);
    },
    [review],
  );

  return {
    phase,
    seconds,
    // Newest level on the right; empty slots on the left until the bar fills.
    liveBars: [...Array.from({ length: LIVE_BARS - live.length }, () => 0), ...live],
    review,
    start,
    toReview,
    sendNow,
    sendReviewed,
    discard,
    dismiss: () => setPhase('idle'),
  };
}

export type VoiceNoteState = ReturnType<typeof useVoiceNote>;

function Bars({
  values,
  className,
  played,
}: {
  values: number[];
  className: string;
  played?: number;
}) {
  return (
    <span
      className="flex h-8 min-w-0 flex-1 items-center justify-between gap-px overflow-hidden"
      aria-hidden="true"
    >
      {values.map((v, i) => (
        <span
          key={i}
          className={cn(
            'w-[3px] shrink-0 rounded-full',
            played !== undefined && i / values.length < played ? 'bg-primary' : className,
          )}
          style={{ height: `${Math.max(4, Math.round(v * 28))}px` }}
        />
      ))}
    </span>
  );
}

/** The composer row while a voice note is being recorded, reviewed, or could not start. */
export function VoiceNoteBar({ voice }: { voice: VoiceNoteState }) {
  const { t } = useTranslation('inbox');
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [playAt, setPlayAt] = useState(0);
  const canPreview =
    typeof document !== 'undefined' &&
    document.createElement('audio').canPlayType('audio/ogg; codecs=opus') !== '';

  if (voice.phase === 'blocked' || voice.phase === 'no-microphone' || voice.phase === 'failed') {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm"
      >
        <MicOff className="size-5 shrink-0 text-destructive" aria-hidden="true" />
        <p className="min-w-0 flex-1 basis-60">
          {voice.phase === 'blocked' ? (
            <>
              <strong>{t('composer.voice.blockedTitle')}</strong> {t('composer.voice.blockedBody')}
            </>
          ) : voice.phase === 'no-microphone' ? (
            t('composer.voice.noMicrophone')
          ) : (
            t('composer.voice.failed')
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="touch" onClick={voice.dismiss}>
            {t('composer.voice.cancel')}
          </Button>
          <Button size="touch" onClick={() => void voice.start()}>
            {t('composer.voice.tryAgain')}
          </Button>
        </div>
      </div>
    );
  }

  const deleteButton = (
    <Button
      variant="ghost"
      size="icon-touch"
      aria-label={t('composer.voice.delete')}
      title={t('composer.voice.delete')}
      onClick={voice.discard}
      className="rounded-full text-destructive hover:text-destructive"
    >
      <Trash2 className="size-5" aria-hidden="true" />
    </Button>
  );
  const sendButton = (onClick: () => void) => (
    <Button
      size="icon-touch"
      aria-label={t('composer.voice.send')}
      title={t('composer.voice.send')}
      onClick={onClick}
      className="rounded-full"
    >
      <SendHorizontal className="size-5" aria-hidden="true" />
    </Button>
  );

  if (voice.phase === 'review' && voice.review) {
    const r = voice.review;
    return (
      <div className="flex items-center gap-1.5" data-testid="voice-review">
        {deleteButton}
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-muted py-1 pr-3.5 pl-1">
          <Button
            size="icon"
            aria-label={playing ? t('composer.voice.pause') : t('composer.voice.play')}
            title={canPreview ? undefined : t('composer.voice.previewUnavailable')}
            disabled={!canPreview}
            onClick={() => {
              const el = audio.current;
              if (!el) return;
              if (el.paused) void el.play();
              else el.pause();
            }}
            className="size-9 shrink-0 rounded-full"
          >
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
          <Bars
            values={r.bars}
            className="bg-muted-foreground/50"
            played={playing ? playAt / r.seconds : undefined}
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {playing
              ? `${formatClock(playAt)} / ${formatClock(r.seconds)}`
              : formatClock(r.seconds)}
          </span>
          <audio
            ref={audio}
            src={r.url}
            preload="auto"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setPlayAt(0);
            }}
            onTimeUpdate={(e) => setPlayAt(e.currentTarget.currentTime)}
          />
        </div>
        {sendButton(() => void voice.sendReviewed())}
      </div>
    );
  }

  // starting / recording
  return (
    <div className="flex items-center gap-1.5" data-testid="voice-recording">
      {deleteButton}
      <span
        className="size-2.5 shrink-0 animate-pulse rounded-full bg-destructive motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span
        role="timer"
        aria-label={t('composer.voice.recordingTime', { time: formatClock(voice.seconds) })}
        className="w-11 shrink-0 text-sm font-semibold tabular-nums"
      >
        {formatClock(voice.seconds)}
      </span>
      <Bars values={voice.liveBars} className="bg-destructive/70" />
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {t('composer.voice.maxLength', { time: formatClock(VOICE_NOTE_MAX_SECONDS) })}
      </span>
      <Button
        variant="outline"
        size="touch"
        disabled={voice.phase !== 'recording'}
        onClick={() => void voice.toReview()}
        className="shrink-0 rounded-full"
      >
        <Square className="size-3.5 fill-current" aria-hidden="true" />
        {t('composer.voice.review')}
      </Button>
      {sendButton(() => void voice.sendNow())}
    </div>
  );
}
