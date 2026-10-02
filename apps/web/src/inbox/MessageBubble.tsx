import clsx from 'clsx';
import type React from 'react';
import type { Message } from '@wa-team-inbox/shared';
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
        className="break-all underline underline-offset-2"
      >
        {p}
      </a>
    ) : (
      p
    ),
  );
}

function quotedPreview(q: Message): string {
  if (q.body) return truncate(q.body, 140);
  switch (q.type) {
    case 'image':
      return '[Image]';
    case 'video':
      return '[Video]';
    case 'audio':
      return '[Audio]';
    case 'sticker':
      return '[Sticker]';
    case 'document':
      return `[Document] ${q.mediaName ?? ''}`.trim();
    default:
      return 'Message';
  }
}

export function StatusTicks({ status }: { status: Message['status'] }) {
  const cls = 'inline-block size-4 shrink-0';
  switch (status) {
    case 'pending':
      return (
        <svg viewBox="0 0 16 16" className={cls} fill="none" stroke="currentColor" strokeWidth="1.5" role="img" aria-label="Pending">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.5V8l2.2 1.5" strokeLinecap="round" />
        </svg>
      );
    case 'sent':
      return (
        <svg viewBox="0 0 16 16" className={cls} fill="none" stroke="currentColor" strokeWidth="1.6" role="img" aria-label="Sent">
          <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'delivered':
    case 'read':
      return (
        <svg
          viewBox="0 0 20 16"
          className={clsx('inline-block h-4 w-5 shrink-0', status === 'read' && 'text-sky-500 dark:text-sky-400')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          role="img"
          aria-label={status === 'read' ? 'Read' : 'Delivered'}
        >
          <path d="M1.5 8.5l3 3 7-7M8.5 11.5l7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'failed':
      return (
        <svg viewBox="0 0 16 16" className={clsx(cls, 'text-red-600 dark:text-red-400')} fill="currentColor" role="img" aria-label="Failed">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 3.5h1.5v5h-1.5v-5zm0 6.25h1.5v1.5h-1.5v-1.5z" />
        </svg>
      );
  }
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
  if (m.type === 'system') {
    return (
      <div className="flex justify-center px-3 py-1">
        <span className="max-w-[85%] rounded-lg bg-neutral-200/80 px-3 py-1 text-center text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
          {m.body}
        </span>
      </div>
    );
  }

  const out = m.fromMe;
  const hasMedia = m.type !== 'text';
  const senderName = m.senderName ?? (m.senderJid ? formatJid(m.senderJid) : null);

  return (
    <div className={clsx('flex px-2 py-0.5 sm:px-4', out ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'relative min-w-0 max-w-[85%] rounded-2xl px-3 py-1.5 shadow-sm sm:max-w-[70%]',
          out
            ? 'rounded-br-md bg-emerald-100 text-neutral-900 dark:bg-emerald-900/60 dark:text-neutral-50'
            : 'rounded-bl-md bg-white text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50',
          m.status === 'failed' && 'ring-1 ring-red-400/70',
        )}
        data-message-id={m.id}
      >
        {!out && showSender && senderName && (
          <p className="mb-0.5 truncate text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            {senderName}
          </p>
        )}
        {out && outboundLabel && (
          <p className="mb-0.5 truncate text-[11px] font-medium text-emerald-800/80 dark:text-emerald-300/80">
            {outboundLabel}
          </p>
        )}
        {m.quotedId && (
          <div className="mb-1 rounded-md border-l-4 border-emerald-500 bg-black/5 px-2 py-1 text-xs dark:bg-white/10">
            {quoted ? (
              <>
                <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                  {quoted.fromMe ? 'You' : (quoted.senderName ?? 'Contact')}
                </p>
                <p className="line-clamp-2 break-words opacity-80">{quotedPreview(quoted)}</p>
              </>
            ) : (
              <p className="italic opacity-70">Quoted message</p>
            )}
          </div>
        )}
        {hasMedia && (
          <div className="mb-1">
            <MediaView message={m} onLoad={onMediaLoad} />
          </div>
        )}
        {m.body && (
          <p className="whitespace-pre-wrap break-words text-[15px] leading-snug [overflow-wrap:anywhere]">
            {linkify(m.body)}
          </p>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          <time dateTime={new Date(m.timestamp).toISOString()} title={formatDateTime(m.timestamp)}>
            {formatTime(m.timestamp)}
          </time>
          {out && <StatusTicks status={m.status} />}
        </div>
        {out && m.status === 'failed' && (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-xs text-red-700 dark:text-red-400">
            <span className="min-w-0 truncate">{m.error ?? 'Not sent'}</span>
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(m)}
                disabled={retrying}
                className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold underline underline-offset-2 disabled:opacity-50 sm:min-h-8"
              >
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
