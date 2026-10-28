import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CircleAlert, CircleCheck, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { checkGrammar, shiftIssues, type GrammarIssue } from '@/mock/grammar';

/** The check runs after this pause in typing, so typing itself makes no model calls. */
const CHECK_PAUSE_MS = 700;

export type GrammarStatus = 'idle' | 'checking' | 'done' | 'skipped' | 'error';

/**
 * Proposed (grammar-fix): checks the typed English after a pause and keeps the underlines in place
 * while the teammate types on (an edited mistake disappears until the next check).
 */
export function useGrammarCheck(text: string, on: boolean) {
  const [issues, setIssues] = useState<GrammarIssue[]>([]);
  const [status, setStatus] = useState<GrammarStatus>('idle');
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const previous = useRef(text);
  /** "Ignore" hides that fix for the rest of this draft. */
  const ignored = useRef(new Set<string>());
  const keyOf = (issue: GrammarIssue) => `${issue.original}→${issue.replacement}`;

  useLayoutEffect(() => {
    setIssues((current) => shiftIssues(current, previous.current, text));
    previous.current = text;
    if (!text.trim()) ignored.current.clear();
  }, [text]);

  useEffect(() => {
    if (!on || !text.trim()) {
      setIssues([]);
      setStatus('idle');
      setCheckedFor(null);
      return;
    }
    if (text === checkedFor) return;
    const cancel = new AbortController();
    const timer = setTimeout(() => {
      setStatus('checking');
      checkGrammar(text, cancel.signal)
        .then((result) => {
          if (cancel.signal.aborted) return;
          if (result.status === 'skipped') {
            setIssues([]);
            setStatus('skipped');
          } else {
            setIssues(result.issues.filter((issue) => !ignored.current.has(keyOf(issue))));
            setStatus('done');
          }
          setCheckedFor(text);
        })
        .catch(() => {
          if (!cancel.signal.aborted) setStatus('error');
        });
    }, CHECK_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      cancel.abort();
    };
  }, [text, on, checkedFor]);

  return {
    issues,
    status,
    ignore(issue: GrammarIssue) {
      ignored.current.add(keyOf(issue));
      setIssues((current) => current.filter((i) => i.id !== issue.id));
    },
  };
}

/**
 * The underlines, drawn in a copy of the text behind the transparent glyphs of the box (as the grey
 * completion is): the box itself never changes until a fix is applied.
 */
export const GrammarMarks = forwardRef<
  HTMLDivElement,
  { text: string; issues: GrammarIssue[]; activeId: string | null }
>(function GrammarMarks({ text, issues, activeId }, ref) {
  if (!issues.length) return null;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const issue of issues) {
    if (issue.start < at || text.slice(issue.start, issue.end) !== issue.original) continue;
    parts.push(text.slice(at, issue.start));
    parts.push(
      <span
        key={issue.id}
        data-issue={issue.id}
        className={cn(
          'rounded-sm underline decoration-wavy decoration-2 underline-offset-4 [text-decoration-skip-ink:none]',
          // A light tint too, so a one-letter mistake ("i", "a") is easy to see.
          issue.kind === 'spelling'
            ? 'decoration-destructive bg-destructive/8'
            : 'decoration-info bg-info/8',
          issue.id === activeId && (issue.kind === 'spelling' ? 'bg-destructive/20' : 'bg-info/20'),
        )}
      >
        {issue.original}
      </span>,
    );
    at = issue.end;
  }
  parts.push(text.slice(at));
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl border border-transparent px-3.5 py-2.5 text-base leading-6 break-words whitespace-pre-wrap text-transparent"
      data-testid="grammar-marks"
    >
      {parts}
    </div>
  );
});

/** The card over one underlined word: the fix as one button, and Ignore. */
export function GrammarCard({
  issue,
  position,
  touch,
  onAccept,
  onIgnore,
  onClose,
  onHover,
}: {
  issue: GrammarIssue;
  position: { left: number; bottom: number };
  touch: boolean;
  onAccept(): void;
  onIgnore(): void;
  onClose(): void;
  onHover(inside: boolean): void;
}) {
  const { t } = useTranslation('inbox');
  return (
    <div
      role="dialog"
      aria-label={t('mockGrammar.cardLabel', { word: issue.original })}
      className="absolute z-20 w-max max-w-[min(20rem,calc(100vw-2rem))] rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
      style={{ left: position.left, bottom: position.bottom }}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      data-testid="grammar-card"
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <span
          className={cn(
            'text-xs font-medium',
            issue.kind === 'spelling' ? 'text-destructive' : 'text-info',
          )}
        >
          {issue.kind === 'spelling' ? t('mockGrammar.spelling') : t('mockGrammar.grammar')}
        </span>
        {touch && (
          <Button
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground"
            aria-label={t('mockGrammar.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="px-1 text-sm text-muted-foreground line-through">{issue.original}</span>
        <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <Button
          size="sm"
          className={cn('font-semibold', touch && 'min-h-11 px-4')}
          onClick={onAccept}
          data-testid="grammar-accept"
        >
          {issue.replacement}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={cn('text-muted-foreground', touch && 'min-h-11')}
          onClick={onIgnore}
          data-testid="grammar-ignore"
        >
          {t('mockGrammar.ignore')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The one button in the composer's bottom row: "Fix 3" (all at once), a quiet check when nothing
 * is wrong, "3 fixed · Undo" for a few seconds after a fix.
 */
export function GrammarFixButton({
  count,
  status,
  unavailable,
  touch,
  undo,
  onFixAll,
  onUndo,
}: {
  count: number;
  status: GrammarStatus;
  unavailable: boolean;
  touch: boolean;
  undo: { count: number } | null;
  onFixAll(): void;
  onUndo(): void;
}) {
  const { t } = useTranslation('inbox');
  if (undo)
    return (
      <span
        role="status"
        className="flex items-center gap-1 text-sm text-muted-foreground"
        data-testid="grammar-undo"
      >
        <CircleCheck className="size-4 text-success" aria-hidden="true" />
        {t('mockGrammar.fixed', { count: undo.count })}
        <Button
          variant="link"
          size="sm"
          className={cn('h-auto px-1 font-semibold', touch && 'min-h-11')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onUndo}
        >
          {t('mockGrammar.undo')}
        </Button>
      </span>
    );
  if (unavailable || status === 'error')
    return (
      <span
        className="flex items-center gap-1 text-xs text-muted-foreground"
        title={t('mockGrammar.unavailableHint')}
        data-testid="grammar-unavailable"
      >
        <CircleAlert className="size-3.5" aria-hidden="true" />
        {t('mockGrammar.unavailable')}
      </span>
    );
  if (count > 0)
    return (
      <Button
        variant="outline"
        size={touch ? 'touch' : 'sm'}
        className="rounded-full border-primary/40 text-primary"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onFixAll}
        title={touch ? undefined : t('mockGrammar.shortcut')}
        data-testid="grammar-fix-all"
      >
        <Sparkles aria-hidden="true" />
        {t('mockGrammar.fixAll', { count })}
        {!touch && (
          <kbd className="ml-1 rounded border bg-muted px-1 font-sans text-[0.7rem] text-muted-foreground">
            Ctrl J
          </kbd>
        )}
      </Button>
    );
  if (status === 'checking')
    return (
      <span className="flex items-center text-muted-foreground" data-testid="grammar-checking">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        <span className="sr-only">{t('mockGrammar.checking')}</span>
      </span>
    );
  if (status === 'done')
    return (
      <span
        className="flex items-center gap-1 text-xs text-muted-foreground"
        data-testid="grammar-clean"
      >
        <CircleCheck className="size-4" aria-hidden="true" />
        {t('mockGrammar.clean')}
      </span>
    );
  return null;
}
