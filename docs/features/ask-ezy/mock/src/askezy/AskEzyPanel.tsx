import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowUp,
  Check,
  CheckCheck,
  Copy,
  Pencil,
  CornerDownRight,
  Loader2,
  BotMessageSquare,
  MessageSquarePlus,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useMediaQuery } from '@/lib/use-media-query';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Banner } from '@/components/app';
import { cn } from '@/lib/utils';
import { ApiError, errorMessage } from '@/api/client';
import { useAuth } from '../auth/AuthProvider';
import {
  askEzy,
  changeAction,
  getMockState,
  setMockState,
  type AskAnswer,
  type AskBlock,
  type MockAskEzyMode,
  type MockState,
} from '../mock/ask-ezy';
import { AskEzyBlock, type ChangeState } from './AskEzyBlocks';
import { useAskEzy, type AskEzyRequest } from './AskEzyContext';

type Turn =
  | { role: 'user'; id: number; text: string }
  | { role: 'ezy'; id: number; answer: AskAnswer; request: AskEzyRequest }
  | { role: 'error'; id: number; code: string; retry: AskEzyRequest; steps: string[] };

const MAX_CHARS = 2000;

/** Desktop pointer: put the cursor back in the box (never on a phone, where it would open the keyboard). */
const finePointer = () => window.matchMedia?.('(pointer: fine)').matches ?? false;

function Suggestions({ items, onPick }: { items: string[]; onPick: (q: string) => void }) {
  return (
    <ul className="flex flex-col items-start gap-1.5">
      {items.map((q) => (
        <li key={q}>
          <Button
            variant="outline"
            size="sm"
            className="h-auto min-h-9 justify-start rounded-md py-1.5 text-left whitespace-normal pointer-coarse:min-h-11"
            onClick={() => onPick(q)}
          >
            <CornerDownRight className="text-muted-foreground" aria-hidden />
            {q}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Test control of the interactive mock only (not part of the product). */
function MockOnly({
  state,
  onChange,
}: {
  state: MockState | null;
  onChange: (s: MockState) => void;
}) {
  const modes: Array<[MockAskEzyMode, string]> = [
    ['normal', 'Normal'],
    ['slow', 'Slow'],
    ['error', 'Error'],
    ['timeout', 'Timeout'],
    ['expired', 'Sign-in expired'],
    ['no_connection', 'No AI connection'],
  ];
  return (
    <fieldset className="mt-6 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
      <legend className="px-1 font-medium">Mock only</legend>
      <div className="flex flex-wrap gap-1">
        {modes.map(([m, label]) => (
          <Button
            key={m}
            size="sm"
            variant={state?.mode === m ? 'secondary' : 'ghost'}
            aria-pressed={state?.mode === m}
            onClick={() => void setMockState({ mode: m }).then(onChange)}
          >
            {label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={state?.applyConflict ? 'secondary' : 'ghost'}
          aria-pressed={!!state?.applyConflict}
          onClick={() => void setMockState({ applyConflict: !state?.applyConflict }).then(onChange)}
        >
          Apply conflict
        </Button>
      </div>
    </fieldset>
  );
}

/** A warning or info message with its action under the text (so a phone never squeezes the text). */
function Notice({
  tone,
  title,
  body,
  action,
  testId,
}: {
  tone: 'info' | 'warning';
  title: string;
  body: string;
  action?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId}>
      <Banner tone={tone} title={title}>
        <p>{body}</p>
        {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
      </Banner>
    </div>
  );
}

/** Plain text of an answer for the clipboard: the text, then each block in short lines. */
function answerAsText(answer: AskAnswer): string {
  const lines = [answer.text];
  for (const b of answer.blocks) {
    if (b.type === 'stats')
      lines.push(
        ...b.items.map((i) => `${i.label}: ${i.value}${i.change ? ` (${i.change})` : ''}`),
      );
    if (b.type === 'bars') lines.push(b.title, ...b.rows.map((r) => `- ${r.label}: ${r.count}`));
    if (b.type === 'chats')
      lines.push(b.title, ...b.chats.map((c) => `- ${c.name} (${c.wait}): ${c.preview}`));
    if (b.type === 'customer')
      lines.push(b.name, ...b.points.map((p) => `- ${p}`), `Next: ${b.next}`);
    if (b.type === 'heatmap' && b.finding) lines.push(b.finding);
  }
  return lines.join('\n');
}

export function AskEzyPanel() {
  const { t } = useTranslation('inbox');
  const { user, isAdmin } = useAuth();
  const { open, closePanel, takePending } = useAskEzy();
  /** From 1280 px the panel docks beside the page (no overlay) so the chat it talks about stays usable. */
  const docked = useMediaQuery('(min-width: 1280px)');
  useEffect(() => {
    const root = document.documentElement;
    if (open && docked) root.dataset.askEzy = 'docked';
    else delete root.dataset.askEzy;
    return () => {
      delete root.dataset.askEzy;
    };
  }, [open, docked]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<{ jid: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [mock, setMock] = useState<MockState | null>(null);
  const [changes, setChanges] = useState<Record<string, ChangeState>>({});
  const abort = useRef<AbortController | null>(null);
  const doneSteps = useRef<string[]>([]);
  const nextId = useRef(1);
  const turnRefs = useRef(new Map<number, HTMLLIElement>());
  const bodyRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const connected = mock?.connected ?? true;

  const send = async (request: AskEzyRequest) => {
    const question = request.question.trim();
    if (!question || busy) return;
    const chatJid = request.chatJid ?? scope?.jid ?? null;
    const userTurn = nextId.current++;
    setTurns((v) => [...v, { role: 'user', id: userTurn, text: question }]);
    setDraft('');
    setSteps([]);
    doneSteps.current = [];
    setBusy(true);
    setStatus(t('askEzy.working'));
    const controller = new AbortController();
    abort.current = controller;
    try {
      const answer = await askEzy(
        question,
        chatJid,
        (label) => {
          doneSteps.current = [...doneSteps.current, label];
          setSteps(doneSteps.current);
        },
        controller.signal,
      );
      const id = nextId.current++;
      setTurns((v) => [...v, { role: 'ezy', id, answer, request: { question, chatJid } }]);
      setStatus(t('askEzy.readyWith', { first: answer.text.split(/(?<=[.!?])\s/)[0] }));
      // A new answer opens at its first line, not at its end (long answers start with the summary).
      requestAnimationFrame(() =>
        turnRefs.current.get(userTurn)?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      );
      if (finePointer()) boxRef.current?.focus({ preventScroll: true });
    } catch (e) {
      const code = controller.signal.aborted
        ? 'stopped'
        : e instanceof ApiError
          ? e.code
          : 'ai_unavailable';
      if (code === 'ai_not_connected') setMock((m) => (m ? { ...m, connected: false } : m));
      setTurns((v) => [
        ...v,
        {
          role: 'error',
          id: nextId.current++,
          code,
          retry: { question, chatJid },
          steps: doneSteps.current,
        },
      ]);
      setStatus(code === 'stopped' ? t('askEzy.errors.stopped') : t('askEzy.errors.short'));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  /** Brings a change card's result (applied, not applied) into view, also on a phone. */
  const revealChange = (id: string) =>
    requestAnimationFrame(() =>
      bodyRef.current
        ?.querySelector(`[data-change-id="${id}"] [data-change-result]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );

  const onChange = async (id: string, action: 'apply' | 'discard' | 'undo') => {
    setChanges((c) => ({
      ...c,
      [id]: { ...(c[id] ?? { status: 'proposed' }), busy: true, error: null },
    }));
    try {
      const r = await changeAction(id, action);
      setChanges((c) => ({ ...c, [id]: { status: r.status, version: r.version } }));
      if (action === 'apply') setStatus(t('askEzy.change.appliedStatus'));
    } catch (e) {
      const message =
        e instanceof ApiError && e.code === 'setup_changed'
          ? t('askEzy.change.conflict')
          : errorMessage(e);
      setChanges((c) => ({
        ...c,
        [id]: { ...(c[id] ?? { status: 'proposed' }), busy: false, error: message },
      }));
      setStatus(message);
    }
    revealChange(id);
  };

  useEffect(() => {
    if (!open) return;
    void getMockState().then(setMock);
    const pending = takePending();
    if (pending?.chatJid && pending.chatName)
      setScope({ jid: pending.chatJid, name: pending.chatName });
    if (pending?.question) void send(pending);
    // On a phone the keyboard would cover the starter questions: focus the box only with a mouse.
    else if (finePointer()) setTimeout(() => boxRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Proposed or applied changes in this conversation: clearing it loses their cards (Undo stays in Setup history). */
  const openChanges = turns.some(
    (turn) =>
      turn.role === 'ezy' &&
      turn.answer.blocks.some(
        (b) => b.type === 'change' && (changes[b.id]?.status ?? b.status) !== 'discarded',
      ),
  );
  const [confirmNew, setConfirmNew] = useState(false);
  const newChat = () => {
    abort.current?.abort();
    setTurns([]);
    setScope(null);
    setDraft('');
    setSteps([]);
    setChanges({});
    boxRef.current?.focus();
  };

  const firstName = user?.displayName?.split(' ')[0] ?? '';
  const starters = isAdmin
    ? [
        t('askEzy.starters.week'),
        t('askEzy.starters.waiting'),
        t('askEzy.starters.handoffs'),
        t('askEzy.starters.fix'),
        t('askEzy.starters.busy'),
      ]
    : [t('askEzy.starters.waiting'), t('askEzy.starters.latest'), t('askEzy.starters.handoffs')];

  const errorText = (code: string) => {
    switch (code) {
      case 'ai_timeout':
        return { title: t('askEzy.errors.timeout'), body: t('askEzy.errors.timeoutBody') };
      case 'ai_expired':
        return {
          title: t('askEzy.errors.expired'),
          body: isAdmin ? t('askEzy.errors.expiredAdmin') : t('askEzy.errors.expiredMember'),
        };
      case 'rate_limited':
        return { title: t('askEzy.errors.busy'), body: t('askEzy.errors.busyBody') };
      default:
        return { title: t('askEzy.errors.unavailable'), body: t('askEzy.errors.unavailableBody') };
    }
  };

  const settingsButton = (primary: boolean) => (
    <Button
      asChild
      size="sm"
      variant={primary ? 'default' : 'outline'}
      className="pointer-coarse:min-h-11"
      onClick={closePanel}
    >
      <Link to="/admin/settings/ai">{t('askEzy.errors.openSettings')}</Link>
    </Button>
  );

  /** The whole empty view when nothing can be asked yet: what to do first, nothing to ask. */
  const setupFirst = (
    <div className="flex flex-col gap-3" data-testid="ask-ezy-setup">
      <p className="text-lg font-semibold">{t('askEzy.noConnection.title')}</p>
      <p className="text-sm text-muted-foreground">{t('askEzy.noConnection.what')}</p>
      <p className="text-sm text-muted-foreground">
        {isAdmin ? t('askEzy.noConnection.admin') : t('askEzy.noConnection.member')}
      </p>
      {isAdmin && <div>{settingsButton(true)}</div>}
    </div>
  );

  return (
    <Sheet open={open} modal={!docked} onOpenChange={(v) => !v && closePanel()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[480px] xl:max-w-[400px]"
        data-testid="ask-ezy-panel"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => docked && e.preventDefault()}
      >
        <header className="safe-top flex items-center gap-1 border-b py-2 pr-2 pl-4 sm:py-3">
          <div className="min-w-0 flex-1">
            <SheetTitle className="flex items-center gap-2 text-base">
              <BotMessageSquare className="size-4 text-primary" aria-hidden />
              {t('askEzy.title')}
            </SheetTitle>
            <SheetDescription className="text-xs max-sm:sr-only">
              {isAdmin ? t('askEzy.subtitleAdmin') : t('askEzy.subtitleMember')}
            </SheetDescription>
          </div>
          {turns.length > 0 && (
            <Button
              variant="ghost"
              size="touch"
              onClick={() => (openChanges ? setConfirmNew(true) : newChat())}
              className="text-muted-foreground"
            >
              <MessageSquarePlus aria-hidden />
              <span className="max-sm:sr-only">{t('askEzy.newChat')}</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-touch"
            onClick={closePanel}
            aria-label={t('askEzy.close')}
          >
            <X aria-hidden />
          </Button>
        </header>

        <AlertDialog open={confirmNew} onOpenChange={setConfirmNew}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('askEzy.newConfirm.title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('askEzy.newConfirm.body')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('askEzy.newConfirm.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmNew(false);
                  newChat();
                }}
              >
                {t('askEzy.newConfirm.confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {turns.length === 0 && !busy && (
            <>
              {connected ? (
                <div className="flex flex-col gap-3" data-testid="ask-ezy-empty">
                  <p className="text-lg font-semibold">{t('askEzy.hello', { name: firstName })}</p>
                  <p className="text-sm text-muted-foreground">
                    {isAdmin ? t('askEzy.introAdmin') : t('askEzy.introMember')}
                  </p>
                  <p className="text-sm font-medium text-muted-foreground">{t('askEzy.tryOne')}</p>
                  <Suggestions items={starters} onPick={(q) => void send({ question: q })} />
                </div>
              ) : (
                setupFirst
              )}
              {isAdmin && <MockOnly state={mock} onChange={setMock} />}
            </>
          )}
          <ol className="flex flex-col gap-5">
            {turns.map((turn) => (
              <li
                key={turn.id}
                ref={(el) => {
                  if (el) turnRefs.current.set(turn.id, el);
                  else turnRefs.current.delete(turn.id);
                }}
                className="flex min-w-0 scroll-mt-2 flex-col gap-2"
              >
                {turn.role === 'user' && (
                  <p className="max-w-[85%] self-end rounded-lg rounded-br-sm bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
                    {turn.text}
                  </p>
                )}
                {turn.role === 'ezy' && (
                  <AnswerView
                    answer={turn.answer}
                    isAdmin={isAdmin}
                    scopeJid={scope?.jid ?? null}
                    changes={changes}
                    onChange={(id, a) => void onChange(id, a)}
                    onNavigate={() => window.innerWidth < 768 && closePanel()}
                    onAsk={(q) => void send({ question: q })}
                    onAskAgain={() => void send(turn.request)}
                  />
                )}
                {turn.role === 'error' &&
                  (turn.code === 'ai_not_connected' ? (
                    <Notice
                      tone="info"
                      testId="ask-ezy-error"
                      title={t('askEzy.noConnection.title')}
                      body={
                        isAdmin ? t('askEzy.noConnection.admin') : t('askEzy.noConnection.member')
                      }
                      action={isAdmin ? settingsButton(true) : undefined}
                    />
                  ) : turn.code === 'stopped' ? (
                    <div
                      className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
                      data-testid="ask-ezy-stopped"
                    >
                      <span>
                        {t('askEzy.errors.stopped')} {t('askEzy.errors.stoppedBody')}
                        {turn.steps.length > 0 && (
                          <span className="block text-xs">
                            {t('askEzy.steps', { steps: turn.steps.join(' · ') })}
                          </span>
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="pointer-coarse:min-h-11"
                        onClick={() => void send(turn.retry)}
                        disabled={busy}
                      >
                        <RotateCcw aria-hidden />
                        {t('askEzy.errors.askAgain')}
                      </Button>
                    </div>
                  ) : (
                    <Notice
                      tone="warning"
                      testId="ask-ezy-error"
                      title={errorText(turn.code).title}
                      body={errorText(turn.code).body}
                      action={
                        turn.code === 'ai_expired' ? (
                          isAdmin ? (
                            settingsButton(true)
                          ) : undefined
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="pointer-coarse:min-h-11"
                              onClick={() => void send(turn.retry)}
                              disabled={busy}
                            >
                              <RotateCcw aria-hidden />
                              {t('askEzy.errors.retry')}
                            </Button>
                            {turn.code === 'ai_unavailable' && isAdmin && (
                              <Button
                                asChild
                                size="sm"
                                variant="outline"
                                className="pointer-coarse:min-h-11"
                                onClick={closePanel}
                              >
                                <Link to="/admin/settings/ai">
                                  {t('askEzy.errors.checkSettings')}
                                </Link>
                              </Button>
                            )}
                            {turn.code === 'ai_timeout' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="pointer-coarse:min-h-11"
                                onClick={() => {
                                  setDraft(turn.retry.question);
                                  boxRef.current?.focus();
                                }}
                              >
                                <Pencil aria-hidden />
                                {t('askEzy.errors.editQuestion')}
                              </Button>
                            )}
                          </>
                        )
                      }
                    />
                  ))}
              </li>
            ))}
          </ol>
          {busy && (
            <div className="mt-4 flex flex-col gap-1.5" data-testid="ask-ezy-thinking">
              <p className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                {t('askEzy.working')}
              </p>
              <ul className="flex flex-col gap-1 pl-6 text-sm text-muted-foreground">
                {steps.map((s, i) => (
                  <li key={`${i}-${s}`} className="flex items-center gap-1.5">
                    <Check className="size-3 text-success" aria-hidden />
                    {t('askEzy.reading', { what: s })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <form
          className="safe-bottom flex flex-col gap-1.5 border-t px-4 pt-3 pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send({ question: draft });
          }}
        >
          {scope && (
            <p className="flex h-7 items-center gap-1 self-start rounded-md bg-muted pr-1 pl-2 text-xs">
              {t('askEzy.scope', { name: scope.name })}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative size-5 rounded-sm text-muted-foreground after:absolute after:-inset-3"
                onClick={() => setScope(null)}
                aria-label={t('askEzy.clearScope')}
              >
                <X className="size-3" aria-hidden />
              </Button>
            </p>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              ref={boxRef}
              value={draft}
              maxLength={MAX_CHARS}
              rows={1}
              disabled={!connected}
              placeholder={isAdmin ? t('askEzy.placeholder') : t('askEzy.placeholderMember')}
              aria-label={isAdmin ? t('askEzy.placeholder') : t('askEzy.placeholderMember')}
              className="max-h-40 min-h-11 resize-none"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send({ question: draft });
                }
              }}
            />
            {busy ? (
              <Button
                type="button"
                variant="outline"
                size="touch"
                className="shrink-0"
                onClick={() => abort.current?.abort()}
              >
                <Square aria-hidden />
                {t('askEzy.stop')}
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon-touch"
                className="shrink-0"
                disabled={!draft.trim() || !connected}
                aria-label={t('askEzy.send')}
              >
                <ArrowUp aria-hidden />
              </Button>
            )}
          </div>
          <p
            className={cn(
              'text-xs text-muted-foreground',
              scope && 'max-sm:hidden',
              !connected && 'hidden',
            )}
          >
            <span className="sm:hidden">{t('askEzy.footerShort')}</span>
            <span className="max-sm:hidden">{t('askEzy.footer')}</span>
          </p>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function AnswerView({
  answer,
  isAdmin,
  scopeJid,
  changes,
  onChange,
  onNavigate,
  onAsk,
  onAskAgain,
}: {
  answer: AskAnswer;
  isAdmin: boolean;
  scopeJid: string | null;
  changes: Record<string, ChangeState>;
  onChange: (id: string, action: 'apply' | 'discard' | 'undo') => void;
  onNavigate: () => void;
  onAsk: (q: string) => void;
  onAskAgain: () => void;
}) {
  const { t } = useTranslation('inbox');
  const wide = window.matchMedia?.('(min-width: 640px)').matches ?? true;
  const proposed = answer.blocks.filter(
    (b): b is Extract<AskBlock, { type: 'change' }> =>
      b.type === 'change' &&
      (changes[b.id]?.status ?? b.status) === 'proposed' &&
      !changes[b.id]?.error,
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answerAsText(answer));
      toast.success(t('askEzy.copied'));
    } catch {
      toast.error(t('askEzy.copyFailed'));
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="ask-ezy-answer">
      <p className="flex gap-2 text-sm">
        <BotMessageSquare className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>{answer.text}</span>
      </p>
      {answer.blocks.map((b, i) => (
        <AskEzyBlock
          key={i}
          block={b}
          ctx={{ scopeJid, onNavigate, changes, onChange, onAskAgain, wide }}
        />
      ))}
      {proposed.length > 1 && (
        <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 p-3">
          <p className="text-sm text-muted-foreground">
            {t('askEzy.change.applyAllNote', {
              count: proposed.length,
              agent: proposed[0]!.agent,
              titles: proposed.map((b) => b.title).join(', '),
            })}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="self-start pointer-coarse:min-h-11"
            onClick={() => proposed.forEach((b) => onChange(b.id, 'apply'))}
            data-testid="ask-ezy-apply-all"
          >
            <CheckCheck aria-hidden />
            {proposed.length === 2
              ? t('askEzy.change.applyBoth')
              : t('askEzy.change.applyAll', { count: proposed.length })}
          </Button>
        </div>
      )}
      {answer.steps.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('askEzy.steps', { steps: answer.steps.join(' · ') })}
        </p>
      )}
      {answer.followUps.length > 0 && <Suggestions items={answer.followUps} onPick={onAsk} />}
      {(answer.blocks.length > 0 || !isAdmin) && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground pointer-coarse:min-h-11"
            onClick={() => void copy()}
          >
            <Copy aria-hidden />
            {isAdmin ? t('askEzy.copy') : t('askEzy.copyForAdmin')}
          </Button>
        </div>
      )}
    </div>
  );
}
