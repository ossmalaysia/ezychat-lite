import type React from 'react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquareText, Paperclip, SendHorizontal, X } from 'lucide-react';
import type { QuickReply } from '@wa-team-inbox/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { QuickReplyPicker, filterQuickReplies } from './QuickReplyPicker';
import { EmojiPicker } from './EmojiPicker';
import './composer.css';

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
  /** The message being replied to: shown in a bar above the box until sent or cancelled. */
  replyTo?: { id: string; author: string; preview: string } | null;
  onCancelReply?(): void;
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
  placeholder,
  replyTo = null,
  onCancelReply,
}: ComposerProps) {
  const { t } = useTranslation('inbox');
  const [text, setText] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const [browseReplies, setBrowseReplies] = useState(false);
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const repliesButtonRef = useRef<HTMLButtonElement>(null);
  const lastTyping = useRef(0);
  const emojiSelection = useRef({ start: 0, end: 0 });
  const pendingCaret = useRef<number | null>(null);
  const pickerId = useId();
  const [coarsePointer] = useState(isCoarsePointer);

  const query = browseReplies ? '' : slashQuery(text);
  const matches = query == null ? [] : filterQuickReplies(quickReplies, query);
  const pickerOpen = query != null && !pickerDismissed && quickReplies.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Choosing Reply puts the cursor in the box, ready to type.
  const replyId = replyTo?.id;
  useEffect(() => {
    if (replyId) areaRef.current?.focus();
  }, [replyId]);

  // scrollHeight includes padding, but not borders. Include the borders so a
  // single line does not overflow by two pixels and show a native scrollbar.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    function resize() {
      if (!el) return;
      el.style.height = 'auto';
      const style = getComputedStyle(el);
      const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const height = el.scrollHeight + (Number.isFinite(borders) ? borders : 0);
      el.style.height = `${Math.min(height, MAX_HEIGHT_PX)}px`;
      el.style.overflowY = height > MAX_HEIGHT_PX ? 'auto' : 'hidden';
    }
    resize();
    if (pendingCaret.current != null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
    // Reflow a draft when the pane is resized or the device rotates.
    if (typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        resize();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  function insertEmoji(emoji: string) {
    const { start, end } = emojiSelection.current;
    const next = text.slice(0, start) + emoji + text.slice(end);
    const caret = start + emoji.length;
    if (next === text) {
      areaRef.current?.focus();
      areaRef.current?.setSelectionRange(caret, caret);
    } else {
      pendingCaret.current = caret;
    }
    setText(next);
    setBrowseReplies(false);
    setPickerDismissed(false);
    emitTyping(next);
  }

  function insertReply(r: QuickReply) {
    const next =
      browseReplies && slashQuery(text) == null && text.trim() ? `${text}\n${r.body}` : r.body;
    setText(next);
    setBrowseReplies(false);
    setPickerDismissed(true);
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.length, next.length);
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
      setBrowseReplies(false);
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
    setBrowseReplies(false);
    if (slashQuery(v) == null) setPickerDismissed(false);
    emitTyping(v);
  }

  function emitTyping(value: string) {
    if (onTyping && value.length > 0) {
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
      setBrowseReplies(false);
      return;
    }
    if (replyTo && e.key === 'Escape') {
      e.preventDefault();
      onCancelReply?.();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !coarsePointer) {
      e.preventDefault();
      void submit();
    }
  }

  const canSend = text.trim().length > 0 && !disabled && !busy;

  const replyBar = replyTo && (
    <div
      className="mb-1.5 flex min-w-0 items-center gap-2 rounded-md border-l-4 border-primary bg-muted py-1 pl-2.5 pr-1"
      data-testid="reply-bar"
    >
      <div className="min-w-0 flex-1 text-xs">
        <p className="truncate font-semibold text-primary">
          {t('composer.replyingTo', { name: replyTo.author })}
        </p>
        <p className="truncate text-muted-foreground">{replyTo.preview}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t('composer.cancelReply')}
        title={t('composer.cancelReply')}
        onClick={() => {
          onCancelReply?.();
          areaRef.current?.focus();
        }}
        className="size-8 shrink-0 text-muted-foreground pointer-coarse:size-11"
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <>
      {replyBar}
      <Popover
        open={pickerOpen}
        onOpenChange={(o) => {
          if (!o) {
            setPickerDismissed(true);
            setBrowseReplies(false);
          }
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
              aria-label={t('composer.attach')}
              title={t('composer.attach')}
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
              className="rounded-full text-muted-foreground"
            >
              <Paperclip className="size-5" aria-hidden="true" />
            </Button>
            <EmojiPicker
              disabled={disabled}
              onOpen={() => {
                const el = areaRef.current;
                emojiSelection.current = {
                  start: el?.selectionStart ?? text.length,
                  end: el?.selectionEnd ?? text.length,
                };
                setBrowseReplies(false);
                setPickerDismissed(true);
              }}
              onPick={insertEmoji}
            />
            <Textarea
              ref={areaRef}
              aria-label={t('composer.message')}
              aria-autocomplete="list"
              aria-expanded={pickerOpen}
              aria-controls={pickerOpen ? pickerId : undefined}
              rows={1}
              value={text}
              disabled={disabled}
              placeholder={placeholder ?? t('composer.placeholder')}
              onChange={onChange}
              onKeyDown={onKeyDown}
              // Enter inserts a newline on touch keyboards, so label the key accordingly.
              enterKeyHint={coarsePointer ? 'enter' : 'send'}
              className="composer-input field-sizing-fixed min-h-11 min-w-0 flex-1 resize-none rounded-2xl bg-surface px-3.5 py-2.5 text-base leading-6 md:text-base"
            />
            <Button
              size="icon-touch"
              aria-label={t('composer.send')}
              title={t('composer.send')}
              disabled={!canSend}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void submit()}
              className="rounded-full"
            >
              <SendHorizontal className="size-5" aria-hidden="true" />
            </Button>
          </div>
        </PopoverAnchor>
        {quickReplies.length > 0 && (
          <Button
            ref={repliesButtonRef}
            variant="ghost"
            size="touch"
            disabled={disabled}
            aria-expanded={pickerOpen}
            aria-controls={pickerOpen ? pickerId : undefined}
            onClick={() => {
              setBrowseReplies(!pickerOpen);
              setPickerDismissed(pickerOpen);
              areaRef.current?.focus();
            }}
            className="mt-1 text-muted-foreground"
          >
            <MessageSquareText aria-hidden="true" />
            {t('composer.quickReplies')}
          </Button>
        )}
        <PopoverContent
          id={pickerId}
          side="top"
          align="start"
          sideOffset={8}
          // Focus stays in the textarea; the Composer drives the highlighted row.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (
              rowRef.current?.contains(e.target as Node) ||
              repliesButtonRef.current?.contains(e.target as Node)
            )
              e.preventDefault();
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
    </>
  );
}
