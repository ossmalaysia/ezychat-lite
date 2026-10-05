import { SendHorizontal, Square, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VOICE_NOTE_MAX_SECONDS } from '@wa-team-inbox/shared';
import { Button } from '@/components/ui/button';
import type { VoiceRecorderState } from './useVoiceRecorder';

function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface VoiceRecorderBarProps {
  state: Exclude<VoiceRecorderState, { status: 'idle' }>;
  busy?: boolean;
  onStop(): void;
  onCancel(): void;
  onSend(): void;
}

/** Replaces the composer row while a voice note is being recorded or listened back. */
export function VoiceRecorderBar({
  state,
  busy = false,
  onStop,
  onCancel,
  onSend,
}: VoiceRecorderBarProps) {
  const { t } = useTranslation('inbox');
  const elapsed = state.status === 'recording' ? state.elapsedMs / 1000 : 0;
  return (
    <div className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon-touch"
        aria-label={t('composer.voice.discard')}
        title={t('composer.voice.discard')}
        onClick={onCancel}
        className="shrink-0 rounded-full text-muted-foreground"
      >
        <Trash2 className="size-5" aria-hidden="true" />
      </Button>
      {state.status === 'review' ? (
        <audio
          aria-label={t('composer.voice.preview')}
          src={state.recording.url}
          controls
          preload="metadata"
          className="h-11 min-w-0 max-w-full flex-1"
        />
      ) : (
        <div
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-input bg-surface px-3.5 py-2.5"
          title={t('composer.voice.limit')}
        >
          <span
            className="size-2.5 shrink-0 rounded-full bg-danger motion-safe:animate-pulse"
            aria-hidden="true"
          />
          <span className="min-w-0 truncate text-sm">
            {state.status === 'starting'
              ? t('composer.voice.starting')
              : t('composer.voice.recording')}
          </span>
          <span
            role="timer"
            aria-live="off"
            className="ml-auto shrink-0 text-sm text-muted-foreground tabular-nums"
          >
            {clock(elapsed)} / {clock(VOICE_NOTE_MAX_SECONDS)}
          </span>
        </div>
      )}
      {state.status === 'review' ? (
        <Button
          size="icon-touch"
          aria-label={t('composer.voice.send')}
          title={t('composer.voice.send')}
          disabled={busy}
          onClick={onSend}
          className="shrink-0 rounded-full"
        >
          <SendHorizontal className="size-5" aria-hidden="true" />
        </Button>
      ) : (
        <Button
          size="icon-touch"
          aria-label={t('composer.voice.stop')}
          title={t('composer.voice.stop')}
          disabled={state.status !== 'recording'}
          onClick={onStop}
          className="shrink-0 rounded-full"
        >
          <Square className="size-4 fill-current" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
