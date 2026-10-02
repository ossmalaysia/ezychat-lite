import clsx from 'clsx';
import type React from 'react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** Set false to prevent closing via backdrop/Escape (e.g. while submitting). */
  dismissable?: boolean;
}

const FOCUSABLE =
  'input, textarea, select, button:not([data-modal-close]), [tabindex]:not([tabindex="-1"])';

/** Dialog: centered card on >= sm, full-screen sheet on phones. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  dismissable = true,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const prevFocus = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, dismissable]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-neutral-950/50"
        aria-hidden="true"
        onClick={() => dismissable && onClose()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          'relative flex h-dvh w-full flex-col bg-white shadow-xl focus:outline-none dark:bg-neutral-900',
          'sm:h-auto sm:max-h-[90dvh] sm:max-w-lg sm:rounded-xl sm:border sm:border-neutral-200 sm:dark:border-neutral-800',
          className,
        )}
      >
        <div className="safe-top flex items-center gap-2 border-b border-neutral-200 pl-4 pr-2 dark:border-neutral-800">
          <h2
            id={titleId}
            className="min-w-0 flex-1 truncate py-3 text-base font-semibold text-neutral-900 dark:text-neutral-50"
          >
            {title}
          </h2>
          {dismissable && (
            <button
              type="button"
              data-modal-close
              onClick={onClose}
              aria-label="Close"
              className="inline-flex size-11 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="safe-bottom border-t border-neutral-200 dark:border-neutral-800">
            <div className="flex flex-col-reverse gap-2 px-4 py-3 sm:flex-row sm:justify-end">
              {footer}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
