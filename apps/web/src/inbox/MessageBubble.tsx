import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertCircle, Check, CheckCheck, Clock, RotateCw } from 'lucide-react';
import type { Message } from '@wa-team-inbox/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDateTime, formatTime, truncate } from '../lib/format';
import { formatJid } from '../lib/jid';
import { MediaView } from './MediaView';

export interface MessageBubbleProps {
  message: Message;
  /** Show the sender name above inbound bubbles (group chats). */
  showSender: boolean;
  /** Outbound label: agent display name, or "via phone" when sent from the phone. */
  outboundLabel: string | null;
  quoted: Message | null;
  onRetry?(m: Message): void;
  retrying?: boolean;
  onMediaLoad?(): void;
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

/** Split text into plain strings and safe <a> elements. */
function linkify(text: string): React.ReactNode[] {
  const parts = text.split(URL_RE);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={p}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="break-all text-primary underline underline-offset-2"
      >
        {p}
      </a>
    ) : (
      p
    ),
  );
}

function quotedPreview(q: Message, t: TFunction<'inbox'>): string {
  if (q.body) return truncate(q.body, 140);
  switch (q.type) {
    case 'image':
      return t('message.quote.image');
    case 'video':
      return t('message.quote.video');
    case 'audio':
      return t('message.quote.audio');
    case 'sticker':
      return t('message.quote.sticker');
    case 'document':
      return t('message.quote.document', { name: q.mediaName ?? '' }).trim();
    default:
      return t('message.quote.message');
  }
}

export function StatusTicks({ status }: { status: Message['status'] }) {
  const { t } = useTranslation('inbox');
  const cls = 'inline-block size-3.5 shrink-0';
  const label = t(`message.status.${status}`);
  switch (status) {
    case 'pending':
      return <Clock className={cls} role="img" aria-label={label} />;
    case 'sent':
      return <Check className={cls} role="img" aria-label={label} />;
    case 'delivered':
      return <CheckCheck className={cls} role="img" aria-label={label} />;
    case 'read':
      return <CheckCheck className={cn(cls, 'text-primary')} role="img" aria-label={label} />;
    case 'failed':
      return <AlertCircle className={cn(cls, 'text-danger')} role="img" aria-label={label} />;
  }
}

/** A voice note's transcript (customer words, shown as text) or why there is none. */
function VoiceTranscript({ message: m }: { message: Message }) {
  const { t } = useTranslation('inbox');
  if (m.transcriptStatus === 'ok' && m.transcript)
    return (
      <p
        className="mb-1 whitespace-pre-wrap break-words text-xs italic text-muted-foreground [overflow-wrap:anywhere]"
        data-testid="voice-transcript"
      >
        <span className="sr-only">{t('message.transcript.label')} </span>
        {m.transcript}
      </p>
    );
  const note =
    m.transcriptStatus === 'pending'
      ? t('message.transcript.pending')
      : m.transcriptStatus === 'failed' ||
          m.transcriptStatus === 'too_long' ||
          m.transcriptStatus === 'unsupported'
        ? t(`message.transcript.${m.transcriptStatus}`)
        : null;
  return note ? <p className="mb-1 text-xs italic text-muted-foreground">{note}</p> : null;
}

export function MessageBubble({
  message: m,
  showSender,
  outboundLabel,
  quoted,
  onRetry,
  retrying,
  onMediaLoad,
}: MessageBubbleProps) {
  const { t } = useTranslation(['inbox', 'common']);
  if (m.type === 'system') {
    return (
      <div className="flex justify-center px-3 py-1">
        <span className="max-w-[85%] rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
          {m.body}
        </span>
      </div>
    );
  }

  const out = m.fromMe;
  const hasMedia = m.type !== 'text';
  // A WhatsApp ID (LID) sender formats to '' (never its digits): fall back to a placeholder.
  const senderName =
    m.senderName ??
    (m.senderJid ? formatJid(m.senderJid) || t('chatListItem.unknownContact') : null);

  return (
    <div className={cn('flex px-2 py-0.5 sm:px-4', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'relative min-w-0 max-w-[85%] rounded-2xl px-3 py-1.5 text-foreground shadow-sm sm:max-w-[70%]',
          out
            ? 'rounded-br-md border border-primary/15 bg-outbound text-outbound-foreground'
            : 'rounded-bl-md border bg-surface',
          m.status === 'failed' && 'border-danger/50',
        )}
        data-message-id={m.id}
      >
        {!out && showSender && senderName && (
          <p className="mb-0.5 truncate text-xs font-semibold text-primary">{senderName}</p>
        )}
        {out && outboundLabel && (
          <p className="mb-0.5 truncate text-[11px] font-medium text-muted-foreground">
            {outboundLabel}
          </p>
        )}
        {m.quotedId && (
          <div className="mb-1 rounded-md border-l-4 border-primary bg-muted/70 px-2 py-1 text-xs">
            {quoted ? (
              <>
                <p className="font-semibold text-primary">
                  {quoted.fromMe ? t('message.you') : (quoted.senderName ?? t('message.contact'))}
                </p>
                <p className="line-clamp-2 break-words text-muted-foreground">
                  {quotedPreview(quoted, t)}
                </p>
              </>
            ) : (
              <p className="italic text-muted-foreground">{t('message.quotedMessage')}</p>
            )}
          </div>
        )}
        {hasMedia && (
          <div className="mb-1">
            <MediaView message={m} onLoad={onMediaLoad} />
          </div>
        )}
        {m.type === 'audio' && <VoiceTranscript message={m} />}
        {m.body && (
          <p className="whitespace-pre-wrap break-words text-[15px] leading-snug [overflow-wrap:anywhere]">
            {linkify(m.body)}
          </p>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          <time dateTime={new Date(m.timestamp).toISOString()} title={formatDateTime(m.timestamp)}>
            {formatTime(m.timestamp)}
          </time>
          {out && <StatusTicks status={m.status} />}
        </div>
        {out && m.status === 'failed' && (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-xs text-danger">
            <span className="min-w-0 truncate">{m.error ?? t('message.notSent')}</span>
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRetry(m)}
                disabled={retrying}
                className="min-h-11 border-danger/40 text-danger hover:bg-danger/10 hover:text-danger sm:min-h-8"
              >
                <RotateCw className={cn(retrying && 'animate-spin')} aria-hidden="true" />
                {retrying ? t('retrying') : t('common:actions.retry')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
