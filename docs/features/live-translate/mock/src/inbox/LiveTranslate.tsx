// Proposed (live-translate): the chat's Translate button, the Live translate bar, the translated bubble text and the
// check-before-sending card. Design: docs/features/live-translate/design.md.
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Languages,
  Loader2,
  RotateCw,
  SendHorizontal,
  Settings2,
  X,
} from 'lucide-react';
import { Banner } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { api, ApiError } from '@/api/client';
import {
  LANGS,
  NATIVE,
  NEXT_CUSTOMER,
  previewTranslation,
  useBubbleTranslation,
  useChatTranslate,
  useLiveTranslateStatus,
  useSetChatTranslate,
  useSetMyLanguage,
  useSetScenario,
  type Lang,
  type MockScenario,
  type PreviewResult,
} from '../mock/liveTranslate';
import type { Message } from '@ezychat/shared';

/** Header button: turns Live translate on or off for this chat, for me only. Hidden while an admin has it off. */
export function TranslateHeaderButton({ jid, className }: { jid: string; className?: string }) {
  const { t } = useTranslation('inbox');
  const status = useLiveTranslateStatus();
  const chat = useChatTranslate(jid);
  const set = useSetChatTranslate(jid);
  if (!status.data?.enabled) return null;
  const on = chat.data?.on ?? false;
  return (
    <Button
      variant="ghost"
      size="touch"
      onClick={() => set.mutate({ on: !on })}
      disabled={chat.isPending || set.isPending}
      aria-pressed={on}
      aria-label={t('mockTranslate.button')}
      title={on ? t('mockTranslate.buttonOn') : t('mockTranslate.buttonOff')}
      data-testid="translate-toggle"
      className={cn(
        'relative',
        on ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      <Languages className="size-5" aria-hidden="true" />
      <span className="@max-4xl:sr-only">{t('mockTranslate.buttonShort')}</span>
    </Button>
  );
}

function LanguageSelect({
  id,
  value,
  onChange,
  autoLabel,
  className,
}: {
  id: string;
  value: Lang | 'auto';
  onChange(v: Lang | 'auto'): void;
  autoLabel?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Lang | 'auto')}>
      <SelectTrigger id={id} className={cn('h-11! w-full bg-surface md:h-9!', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {autoLabel && (
          <SelectItem value="auto" className="min-h-11 md:min-h-8">
            {autoLabel}
          </SelectItem>
        )}
        {LANGS.map((l) => (
          <SelectItem key={l} value={l} lang={l} className="min-h-11 md:min-h-8">
            {NATIVE[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The slim bar under the header while Live translate is on in this chat. */
export function TranslateBar({
  jid,
  isGroup,
  showOriginals,
  onShowOriginals,
}: {
  jid: string;
  isGroup: boolean;
  showOriginals: boolean;
  onShowOriginals(v: boolean): void;
}) {
  const { t } = useTranslation('inbox');
  const status = useLiveTranslateStatus();
  const chat = useChatTranslate(jid);
  const set = useSetChatTranslate(jid);
  const setMine = useSetMyLanguage();
  const customerId = useId();
  const myId = useId();
  const originalsId = useId();
  if (!status.data?.enabled || !chat.data?.on) return null;
  const my = status.data.myLanguage;
  const customer = chat.data.customerLanguage ?? chat.data.detected;
  const same = !isGroup && customer === my;
  const notice = !status.data.connected
    ? { tone: 'warning' as const, text: t('mockTranslate.bar.noConnection') }
    : status.data.scenario === 'limit' ||
        (status.data.dailyLimit > 0 && status.data.usedByMe >= status.data.dailyLimit)
      ? { tone: 'warning' as const, text: t('mockTranslate.bar.limit') }
      : same
        ? { tone: 'info' as const, text: t('mockTranslate.bar.same') }
        : !isGroup && !customer
          ? { tone: 'info' as const, text: t('mockTranslate.bar.notDetected') }
          : null;
  return (
    <div
      className="border-b bg-accent/40 px-3 py-1.5 text-sm md:px-4"
      data-testid="translate-bar"
      role="region"
      aria-label={t('mockTranslate.bar.label')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-accent-foreground">
          <Languages className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {isGroup
              ? t('mockTranslate.bar.groupPair', { my: NATIVE[my] })
              : t('mockTranslate.bar.pair', {
                  customer: customer ? NATIVE[customer] : t('mockTranslate.bar.unknown'),
                  my: NATIVE[my],
                })}
          </span>
          {!isGroup && !chat.data.customerLanguage && customer && (
            <span className="shrink-0 text-xs font-normal text-muted-foreground">
              {t('mockTranslate.bar.detected')}
            </span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Label
            htmlFor={originalsId}
            className="flex min-h-11 cursor-pointer items-center gap-2 px-1 text-xs font-normal text-muted-foreground md:min-h-8"
          >
            <Switch
              id={originalsId}
              checked={showOriginals}
              onCheckedChange={onShowOriginals}
              data-testid="translate-originals"
            />
            {t('mockTranslate.bar.showOriginals')}
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-touch"
                aria-label={t('mockTranslate.bar.languages')}
                title={t('mockTranslate.bar.languages')}
                data-testid="translate-languages"
                className="text-muted-foreground"
              >
                <Settings2 className="size-4" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-4">
              <p className="text-sm font-semibold">{t('mockTranslate.bar.languagesTitle')}</p>
              {!isGroup && (
                <div className="space-y-1.5">
                  <Label htmlFor={customerId}>{t('mockTranslate.bar.customerWrites')}</Label>
                  <LanguageSelect
                    id={customerId}
                    value={chat.data.customerLanguage ?? 'auto'}
                    autoLabel={
                      chat.data.detected
                        ? t('mockTranslate.bar.autoDetected', { lang: NATIVE[chat.data.detected] })
                        : t('mockTranslate.bar.auto')
                    }
                    onChange={(v) => set.mutate({ customerLanguage: v === 'auto' ? null : v })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('mockTranslate.bar.customerHelp')}
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor={myId}>{t('mockTranslate.bar.youWrite')}</Label>
                <LanguageSelect
                  id={myId}
                  value={my}
                  onChange={(v) => v !== 'auto' && setMine.mutate(v)}
                />
                <p className="text-xs text-muted-foreground">{t('mockTranslate.bar.youHelp')}</p>
              </div>
              <Button
                variant="outline"
                size="touch"
                className="w-full"
                onClick={() => set.mutate({ on: false })}
                data-testid="translate-off"
              >
                {t('mockTranslate.bar.turnOff')}
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {isGroup && (
        <p className="pb-0.5 text-xs text-muted-foreground">{t('mockTranslate.bar.groupNote')}</p>
      )}
      {notice && (
        <p
          className={cn(
            'flex items-start gap-1.5 pb-0.5 text-xs',
            notice.tone === 'warning' ? 'text-warning' : 'text-muted-foreground',
          )}
          role="status"
        >
          {notice.tone === 'warning' && (
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          )}
          {notice.text}
        </p>
      )}
    </div>
  );
}

/** Mock only: scenarios and "Customer writes", in the dashed strip the other mock controls use. */
export function TranslateMockStrip({ jid }: { jid: string }) {
  const { t } = useTranslation('inbox');
  const status = useLiveTranslateStatus();
  const chat = useChatTranslate(jid);
  const scenario = useSetScenario();
  const incoming = useMutation({
    mutationFn: () => api('/dev/fake-incoming', { method: 'POST', body: NEXT_CUSTOMER }),
  });
  const labelId = useId();
  if (!status.data?.enabled || !chat.data?.on) return null;
  return (
    <div
      className="mx-3 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed px-3 py-2 md:mx-4"
      data-testid="translate-mock"
    >
      <Badge variant="outline">{t('mockTranslate.mock.label')}</Badge>
      <span id={labelId} className="text-sm font-medium">
        {t('mockTranslate.mock.scenario')}
      </span>
      <Select
        value={status.data.scenario}
        onValueChange={(v) => scenario.mutate(v as MockScenario)}
      >
        <SelectTrigger
          aria-labelledby={labelId}
          className="h-11! w-44 bg-surface md:h-8!"
          data-testid="translate-mock-scenario"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {(['normal', 'slow', 'error', 'limit', 'no_connection', 'number_changed'] as const).map(
            (v) => (
              <SelectItem key={v} value={v} className="min-h-11 md:min-h-8">
                {t(`mockTranslate.mock.${v}`)}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
      {jid === NEXT_CUSTOMER.chatJid && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => incoming.mutate()}
          disabled={incoming.isPending}
          data-testid="translate-mock-incoming"
        >
          {t('mockTranslate.mock.customerWrites')}
        </Button>
      )}
    </div>
  );
}

/** A small line under the text, with a link that shows the other version. */
function TranslationLine({
  label,
  toggle,
  open,
  onToggle,
  testId,
}: {
  label: string;
  toggle?: string;
  open?: boolean;
  onToggle?(): void;
  testId?: string;
}) {
  return (
    <p
      className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground"
      data-testid={testId}
    >
      <Languages className="size-3 shrink-0" aria-hidden="true" />
      <span>{label}</span>
      {toggle && onToggle && (
        <>
          <span aria-hidden="true">·</span>
          <Button
            variant="link"
            onClick={onToggle}
            aria-expanded={open}
            className="h-auto p-0 text-[11px] font-medium text-primary pointer-coarse:min-h-8"
          >
            {toggle}
          </Button>
        </>
      )}
    </p>
  );
}

/** The other version of a message, under the line (the original, or what was sent / typed). */
function OtherVersion({ label, text, lang }: { label: string; text: string; lang: string }) {
  return (
    <div className="mt-1 rounded-md border-l-2 border-muted-foreground/30 bg-muted/60 px-2 py-1">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p
        lang={lang}
        className="whitespace-pre-wrap break-words text-sm leading-snug [overflow-wrap:anywhere]"
      >
        {text}
      </p>
    </div>
  );
}

/**
 * The text of a bubble. Live translate on: the customer's words in my language (or what I typed for my own
 * replies), with the original one tap away. Off: the real message, plus "Written in …" on a reply that went
 * through Live translate.
 */
export function BubbleText({ m, render }: { m: Message; render(text: string): React.ReactNode }) {
  const { t } = useTranslation('inbox');
  const found = useBubbleTranslation(m);
  const [open, setOpen] = useState<boolean | null>(null);
  const body = m.body ?? '';
  const main = (text: string, lang?: string) => (
    <p
      lang={lang}
      className="whitespace-pre-wrap break-words text-[15px] leading-snug [overflow-wrap:anywhere]"
    >
      {render(text)}
    </p>
  );
  if (!found) return main(body);
  const { ctx, tr } = found;
  const expanded = open ?? ctx.showOriginals;
  if (tr?.kind === 'written') {
    const writer = tr.by == null ? null : ctx.nameOf(tr.by);
    // On, and I can read what was typed: show it, with what the customer got one tap away.
    if (ctx.active && tr.from === ctx.my)
      return (
        <div data-testid="bubble-written-mine">
          {main(tr.original, tr.from)}
          <TranslationLine
            label={t('mockTranslate.bubble.sentIn', { lang: NATIVE[tr.to] })}
            toggle={expanded ? t('mockTranslate.bubble.hide') : t('mockTranslate.bubble.showSent')}
            open={expanded}
            onToggle={() => setOpen(!expanded)}
          />
          {expanded && (
            <OtherVersion label={t('mockTranslate.bubble.sentLabel')} text={body} lang={tr.to} />
          )}
        </div>
      );
    return (
      <div data-testid="bubble-written">
        {main(body, tr.to)}
        <TranslationLine
          label={
            writer
              ? t('mockTranslate.bubble.writtenInBy', { lang: NATIVE[tr.from], name: writer })
              : t('mockTranslate.bubble.writtenIn', { lang: NATIVE[tr.from] })
          }
          toggle={expanded ? t('mockTranslate.bubble.hide') : t('mockTranslate.bubble.showTyped')}
          open={expanded}
          onToggle={() => setOpen(!expanded)}
        />
        {expanded && (
          <OtherVersion
            label={
              tr.edited
                ? t('mockTranslate.bubble.typedEdited')
                : t('mockTranslate.bubble.typedLabel')
            }
            text={tr.original}
            lang={tr.from}
          />
        )}
      </div>
    );
  }
  if (!ctx.active) return main(body);
  if (tr?.kind === 'translated')
    return (
      <div data-testid="bubble-translated">
        {main(tr.text, ctx.my)}
        <TranslationLine
          label={t('mockTranslate.bubble.translatedFrom', { lang: NATIVE[tr.from] })}
          toggle={
            expanded
              ? t('mockTranslate.bubble.hideOriginal')
              : t('mockTranslate.bubble.showOriginal')
          }
          open={expanded}
          onToggle={() => setOpen(!expanded)}
        />
        {expanded && (
          <OtherVersion
            label={t('mockTranslate.bubble.originalLabel')}
            text={body}
            lang={tr.from}
          />
        )}
      </div>
    );
  if (tr?.kind === 'failed')
    return (
      <div data-testid="bubble-failed">
        {main(body, tr.from)}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] text-warning">
          <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
          {t(
            `mockTranslate.bubble.failed.${tr.code === 'translate_limit' ? 'limit' : tr.code === 'ai_unavailable' ? 'ai' : 'error'}`,
          )}
          {tr.code === 'error' && (
            <>
              <span aria-hidden="true">·</span>
              <Button
                variant="link"
                onClick={ctx.retry}
                className="h-auto p-0 text-[11px] font-medium text-primary pointer-coarse:min-h-8"
              >
                {t('mockTranslate.bubble.retry')}
              </Button>
            </>
          )}
        </p>
      </div>
    );
  // Not translated yet (just arrived) and in another language than mine.
  if (!tr && ctx.pending && !m.fromMe)
    return (
      <div>
        {main(body)}
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          {t('mockTranslate.bubble.translating')}
        </p>
      </div>
    );
  return main(body);
}

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'ready'; result: Extract<PreviewResult, { status: 'ok' }> }
  | { kind: 'refused'; items: string[] }
  | { kind: 'error'; code: string };

/**
 * Check before sending: what the customer will get (editable), what it means in my language, and the way out
 * (send what I typed). Nothing is sent until the person presses a button.
 */
export function SendPreview({
  jid,
  typed,
  my,
  customer,
  dailyLimit,
  onSend,
  onSendOriginal,
  onDiscard,
}: {
  jid: string;
  typed: string;
  my: Lang;
  customer: Lang;
  dailyLimit: number;
  onSend(text: string, original: string, edited: boolean): void;
  onSendOriginal(text: string): void;
  onDiscard(): void;
}) {
  const { t } = useTranslation('inbox');
  const [mine, setMine] = useState(typed);
  const [editingMine, setEditingMine] = useState(false);
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  const [draft, setDraft] = useState('');
  const [round, setRound] = useState(0);
  const sendRef = useRef<HTMLButtonElement>(null);
  const textId = useId();
  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    previewTranslation(jid, { text: mine, from: my, to: customer }).then(
      (result) => {
        if (!live) return;
        if (result.status === 'refused') return setState({ kind: 'refused', items: result.items });
        setDraft(result.text);
        setState({ kind: 'ready', result });
      },
      (err: unknown) =>
        live && setState({ kind: 'error', code: err instanceof ApiError ? err.code : 'error' }),
    );
    return () => {
      live = false;
    };
    // Re-run only on "Translate again" (round), not on every keystroke in "You wrote".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);
  useEffect(() => {
    if (state.kind === 'ready') sendRef.current?.focus();
  }, [state.kind]);
  const edited = state.kind === 'ready' && draft.trim() !== state.result.text.trim();
  const send = () => state.kind === 'ready' && draft.trim() && onSend(draft.trim(), mine, edited);
  return (
    <section
      className="mb-2 rounded-xl border bg-surface shadow-sm"
      aria-label={t('mockTranslate.preview.title')}
      data-testid="translate-preview"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDiscard();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          send();
        }
      }}
    >
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <Languages className="size-4 text-primary" aria-hidden="true" />
        <p className="flex-1 text-sm font-semibold">{t('mockTranslate.preview.title')}</p>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {NATIVE[my]} <ArrowRight className="size-3" aria-hidden="true" /> {NATIVE[customer]}
        </span>
        <Button
          variant="ghost"
          size="icon-touch"
          onClick={onDiscard}
          aria-label={t('mockTranslate.preview.discard')}
          title={t('mockTranslate.preview.discard')}
          className="text-muted-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="max-h-[45dvh] space-y-2 overflow-y-auto px-3 py-2">
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t('mockTranslate.preview.youWrote')}
            </p>
            {!editingMine && (
              <Button
                variant="link"
                className="h-auto p-0 text-xs pointer-coarse:min-h-8"
                onClick={() => setEditingMine(true)}
              >
                {t('mockTranslate.preview.editMine')}
              </Button>
            )}
          </div>
          {editingMine ? (
            <div className="mt-1 space-y-1.5">
              <Textarea
                value={mine}
                onChange={(e) => setMine(e.target.value)}
                lang={my}
                aria-label={t('mockTranslate.preview.youWrote')}
                className="min-h-16 text-[15px]"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!mine.trim()}
                onClick={() => {
                  setEditingMine(false);
                  setRound((n) => n + 1);
                }}
              >
                <RotateCw aria-hidden="true" />
                {t('mockTranslate.preview.translateAgain')}
              </Button>
            </div>
          ) : (
            <p
              lang={my}
              className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]"
            >
              {mine}
            </p>
          )}
        </div>
        {state.kind === 'loading' && (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t('mockTranslate.preview.translating', { lang: NATIVE[customer] })}
          </p>
        )}
        {state.kind === 'ready' && (
          <>
            <div className="space-y-1">
              <Label htmlFor={textId} className="text-xs font-medium text-muted-foreground">
                {t('mockTranslate.preview.willSend', { lang: NATIVE[customer] })}
              </Label>
              <Textarea
                id={textId}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                lang={customer}
                className="min-h-16 bg-outbound text-[15px] text-outbound-foreground"
                data-testid="translate-preview-text"
              />
            </div>
            <div className="text-sm">
              <p className="text-xs font-medium text-muted-foreground">
                {t('mockTranslate.preview.means', { lang: NATIVE[my] })}
              </p>
              <p
                lang={my}
                className="whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere]"
              >
                {state.result.back}
              </p>
              {edited && (
                <p className="mt-1 text-xs text-warning">{t('mockTranslate.preview.editedNote')}</p>
              )}
            </div>
          </>
        )}
        {state.kind === 'refused' && (
          <Banner tone="warning" title={t('mockTranslate.preview.refusedTitle')}>
            {t('mockTranslate.preview.refused', { items: state.items.join(', ') })}
          </Banner>
        )}
        {state.kind === 'error' && (
          <Banner tone={state.code === 'translate_limit' ? 'warning' : 'danger'}>
            {state.code === 'translate_limit'
              ? t('mockTranslate.preview.limit', { count: dailyLimit })
              : state.code === 'ai_unavailable'
                ? t('mockTranslate.preview.errorAi')
                : state.code === 'translate_off'
                  ? t('mockTranslate.preview.off')
                  : t('mockTranslate.preview.error')}
          </Banner>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t px-3 py-2">
        <Button
          variant="ghost"
          size="touch"
          onClick={() => onSendOriginal(mine)}
          data-testid="translate-send-original"
          className="mr-auto"
        >
          {t('mockTranslate.preview.sendOriginal', { lang: NATIVE[my] })}
        </Button>
        {(state.kind === 'refused' || state.kind === 'error') && (
          <Button variant="outline" size="touch" onClick={() => setRound((n) => n + 1)}>
            <RotateCw aria-hidden="true" />
            {t('mockTranslate.preview.retry')}
          </Button>
        )}
        <Button
          ref={sendRef}
          size="touch"
          onClick={send}
          disabled={state.kind !== 'ready' || !draft.trim()}
          data-testid="translate-send"
        >
          <SendHorizontal aria-hidden="true" />
          {t('mockTranslate.preview.send', { lang: NATIVE[customer] })}
        </Button>
      </div>
    </section>
  );
}
