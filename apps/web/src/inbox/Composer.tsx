import type React from 'react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Paperclip, SendHorizontal } from 'lucide-react';
import type { QuickReply } from '@wa-team-inbox/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
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
  const rowRef = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  const pickerId = useId();
  const [coarsePointer] = useState(isCoarsePointer);

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
    if (e.key === 'Enter' && !e.shiftKey && !coarsePointer) {
      e.preventDefault();
      void submit();
    }
  }

  const canSend = text.trim().length > 0 && !disabled && !busy;

  return (
    <Popover
      open={pickerOpen}
      onOpenChange={(o) => {
        if (!o) setPickerDismissed(true);
      }}
    >
      <PopoverAnchor asChild>
        <div ref={rowRef} className="flex items-end gap-1.5">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void onFile(e)}
          />
          <Button
            variant="ghost"
            size="icon-touch"
            aria-label="Attach file"
            title="Attach file"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            className="rounded-full text-muted-foreground"
          >
            <Paperclip className="size-5" aria-hidden="true" />
          </Button>
          <Textarea
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
            // Enter inserts a newline on touch keyboards, so label the key accordingly.
            enterKeyHint={coarsePointer ? 'enter' : 'send'}
            className="field-sizing-fixed min-h-11 flex-1 resize-none rounded-2xl bg-surface px-3.5 py-2.5 text-base leading-6 md:text-base"
          />
          <Button
            size="icon-touch"
            aria-label="Send"
            title="Send"
            disabled={!canSend}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void submit()}
            className="rounded-full"
          >
            <SendHorizontal className="size-5" aria-hidden="true" />
          </Button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        id={pickerId}
        side="top"
        align="start"
        sideOffset={8}
        // Focus stays in the textarea; the Composer drives the highlighted row.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (rowRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-1rem)] overflow-hidden p-0"
      >
        <QuickReplyPicker
          replies={quickReplies}
          query={query ?? ''}
          activeIndex={activeIndex}
          onPick={insertReply}
          onHover={setActiveIndex}
        />
      </PopoverContent>
    </Popover>
  );
}