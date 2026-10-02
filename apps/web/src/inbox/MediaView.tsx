import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Message } from '@wa-team-inbox/shared';
import { api } from '../api/client';
import { upsertMessageInCache } from '../api/queries';
import { Spinner } from '../components/legacy';

export interface MediaViewProps {
  message: Message;
  /** Fired when an image/video finishes loading (lets the list keep its scroll anchored). */
  onLoad?(): void;
}

function useRedownload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<Message>(`/media/${encodeURIComponent(id)}/redownload`, { method: 'POST' }),
    onSuccess: (m) => {
      if (m && typeof m === 'object' && 'id' in m) upsertMessageInCache(qc, m);
    },
  });
}

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      className="safe-top safe-bottom safe-x fixed inset-0 z-50 flex flex-col bg-neutral-950/95"
      onClick={onClose}
    >
      <div className="flex justify-end gap-1 p-2">
        <a
          href={src}
          download
          onClick={(e) => e.stopPropagation()}
          className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-white hover:bg-white/10"
        >
          Download
        </a>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="inline-flex size-11 items-center justify-center rounded-lg text-white hover:bg-white/10"
        >
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2">
        <img
          src={src}
          alt={alt}
          className="max-h-full max-w-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>,
    document.body,
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-8 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" strokeLinejoin="round" />
      <path d="M14 3v5h5M9 13h6M9 17h4" strokeLinecap="round" />
    </svg>
  );
}

/** Renders the media part of a message (image, sticker, video, audio, document). */
export function MediaView({ message: m, onLoad }: MediaViewProps) {
  const [open, setOpen] = useState(false);
  const redownload = useRedownload();
  const label = m.mediaName ?? m.type;

  if (m.mediaStatus === 'pending' || (!m.mediaUrl && m.status === 'pending')) {
    return (
      <div className="flex min-h-14 items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10">
        <Spinner className="size-4" label="Media loading" />
        <span className="truncate">{m.fromMe ? 'Uploading' : 'Downloading'} {label}…</span>
      </div>
    );
  }

  if (m.mediaStatus === 'failed' || !m.mediaUrl) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10">
        <span className="min-w-0 flex-1 truncate">
          {m.mediaStatus === 'failed' ? `Couldn’t load ${label}` : `${label} unavailable`}
        </span>
        {!m.id.startsWith('local-') && (
          <button
            type="button"
            onClick={() => redownload.mutate(m.id)}
            disabled={redownload.isPending}
            className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
          >
            {redownload.isPending ? 'Retrying…' : 'Retry download'}
          </button>
        )}
      </div>
    );
  }

  const url = m.mediaUrl;

  switch (m.type) {
    case 'image':
    case 'sticker':
      return (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="block overflow-hidden rounded-lg"
            aria-label={`Open ${m.type}`}
          >
            <img
              src={url}
              alt={m.body ?? m.mediaName ?? 'Image'}
              loading="lazy"
              onLoad={onLoad}
              className={
                m.type === 'sticker'
                  ? 'size-32 object-contain'
                  : 'max-h-72 w-full max-w-full object-cover sm:max-w-xs'
              }
            />
          </button>
          {open && <Lightbox src={url} alt={m.body ?? 'Image'} onClose={() => setOpen(false)} />}
        </>
      );
    case 'video':
      return (
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={onLoad}
          className="max-h-72 w-full max-w-full rounded-lg bg-black sm:max-w-xs"
        />
      );
    case 'audio':
      return <audio src={url} controls preload="metadata" className="w-64 max-w-full" />;
    default:
      return (
        <a
          href={url}
          download={m.mediaName ?? true}
          className="flex min-h-14 max-w-full items-center gap-3 rounded-lg bg-black/5 px-3 py-2 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
        >
          <DocIcon />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{m.mediaName ?? 'Document'}</span>
            <span className="block truncate text-xs opacity-70">
              {m.mediaMime ?? 'File'} · Download
            </span>
          </span>
        </a>
      );
  }
}
