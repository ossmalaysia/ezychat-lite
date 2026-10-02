import clsx from 'clsx';
import type React from 'react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { QuickReply } from '@wa-team-inbox/shared';
import { QuickReplyPicker, filterQuickReplies } from './QuickReplyPicker';

export interface ComposerProps {
  quickReplies: QuickReply[];
  onSend(text: string): void;
  /** Attach button: file + caption (current text, if any). */
  onAttach(file: File, caption?: string): void;
  /** Called while typing; throttled to once per 2s. */
  onTyping?(): void;
  /**
   * Called before every send/attach. Resolve `false` to cancel (the text is kept).
   * Used for the "Assigned to X — reply anyway?" confirmation.
   */
  confirmSend?(): boolean | Promise<boolean>;
  disabled?: boolean;
  placeholder?: string;
}

const TYPING_THROTTLE_MS = 2_000;
const MAX_HEIGHT_PX = 160;

/** Touch devices: Enter inserts a newline, the Send button sends. */
function isCoarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** `/pri` → `pri`; anything else (incl. text with spaces) → null. */
function slashQuery(text: string): string | null {
  const m = /^\/(\S*)$/.exec(text);
  return m ? (m[1] ?? '') : null;
}

export function Composer({
  quickReplies,
  onSend,
  onAttach,
  onTyping,
  confirmSend,
  disabled = false,
  placeholder = 'Type a message',
}: ComposerProps) {
  const [text, setText] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const pickerId = useId();

  const query = slashQuery(text);
  const matches = query == null ? [] : filterQuickReplies(quickReplies, query);
  const pickerOpen = query != null && !pickerDismissed && quickReplies.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Autosize the textarea.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  function insertReply(r: QuickReply) {
    setText(r.body);
    setPickerDismissed(true);
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(r.body.length, r.body.length);
      }
    });
  }

  async function confirmed(): Promise<boolean> {
    if (!confirmSend) return true;
    try {
      return await confirmSend();
    } catch {
      return false;
    }
  }

  async function submit() {
    const value = text.trim();
    if (!value || disabled || busy) return;
    setBusy(true);
    try {
      if (!(await confirmed())) return;
      onSend(value);
      setText('');
      setPickerDismissed(false);
    } finally {
      setBusy(false);
      areaRef.current?.focus();
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || disabled) return;
    if (!(await confirmed())) return;
    const caption = text.trim();
    onAttach(file, caption || undefined);
    setText('');
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setText(v);
    if (slashQuery(v) == null) setPickerDismissed(false);
    if (onTyping && v.length > 0) {
      const now = Date.now();
      if (now - lastTyping.current >= TYPING_THROTTLE_MS) {
        lastTyping.current = now;
        onTyping();
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (pickerOpen && matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        const r = matches[Math.min(activeIndex, matches.length - 1)];
        if (r) insertReply(r);
        return;
      }
    }
    if (pickerOpen && e.key === 'Escape') {
      e.preventDefault();
      setPickerDismissed(true);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !isCoarsePointer()) {
      e.preventDefault();
      void submit();
    }
  }

  const canSend = text.trim().length > 0 && !disabled && !busy;

  return (
    <div className="relative">
      {pickerOpen && (
        <QuickReplyPicker
          id={pickerId}
          replies={quickReplies}
          query={query ?? ''}
          activeIndex={activeIndex}
          onPick={insertReply}
          onHover={setActiveIndex}
        />
      )}
      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void onFile(e)}
        />
        <button
          type="button"
          aria-label="Attach file"
          title="Attach file"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path
              d="M21 12.5l-8.5 8.5a5.5 5.5 0 01-7.8-7.8l9-9a3.7 3.7 0 015.2 5.2l-9 9a1.8 1.8 0 01-2.6-2.6l8.3-8.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <textarea
          ref={areaRef}
          aria-label="Message"
          aria-autocomplete="list"
          aria-expanded={pickerOpen}
          aria-controls={pickerOpen ? pickerId : undefined}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={onChange}
          onKeyDown={onKeyDown}
          enterKeyHint="send"
          className={clsx(
            'min-h-11 flex-1 resize-none rounded-2xl border border-neutral-300 bg-white px-3.5 py-2.5 text-base leading-6 text-neutral-900',
            'placeholder:text-neutral-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40',
            'disabled:cursor-not-allowed disabled:opacity-60',
            'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500',
          )}
        />
        <button
          type="button"
          aria-label="Send"
          title="Send"
          disabled={!canSend}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void submit()}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 dark:bg-emerald-500 dark:text-neutral-950 dark:hover:bg-emerald-400"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
            <path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.99.99 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
