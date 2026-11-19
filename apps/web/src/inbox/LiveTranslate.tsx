// Live translate: the chat's Translate button, the bar, the off-state hint, the translated bubble text and the
// "Customer will get" preview. Labels match Cloud's (anchorsprint/ezychat-cloud #107).
// Design: docs/features/live-translate/design.md (confirmed mock 2026-11-19).
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Check,
  Languages,
  Loader2,
  Pencil,
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
import { ApiError } from '@/api/client';
import {
  NATIVE,
  TRANSLATE_LANGUAGES,
  customerLanguageOf,
  outgoingLanguageOf,
  translateDraft,
  useBubbleTranslation,
  useChatTranslate,
  useLiveTranslateStatus,
  useMyTranslate,
  useSetChatTranslate,
  useSetMyTranslate,
  type TranslateLanguage as Lang,
} from '@/api/live-translate';
import type { TranslatableMessage, TranslateDraft } from '@/api/live-translate-types';

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
      aria-label={t('liveTranslate.button')}
      title={on ? t('liveTranslate.buttonOn') : t('liveTranslate.buttonOff')}
      data-testid="translate-toggle"
      className={cn(
        'relative',
        on ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      <Languages className="size-5" aria-hidden="true" />
      <span className="@max-4xl:sr-only">{t('liveTranslate.buttonShort')}</span>
    </Button>
  );
}

function LanguageSelect({
  id,
  value,
  onChange,
  autoLabel,
}: {
  id: string;
  value: Lang | 'auto';
  onChange(v: Lang | 'auto'): void;
  autoLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Lang | 'auto')}>
      <SelectTrigger id={id} className="h-11! w-full bg-surface md:h-9!">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {autoLabel && (
          <SelectItem value="auto" className="min-h-11 md:min-h-8">
            {autoLabel}
          </SelectItem>
        )}
        {TRANSLATE_LANGUAGES.map((l) => (
          <SelectItem key={l} value={l} lang={l} className="min-h-11 md:min-h-8">
            {NATIVE[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
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
  const setMe = useSetMyTranslate();
  const { myLanguage: my } = useMyTranslate();
  const online = useOnline();
  const customerId = useId();
  const myId = useId();
  const outId = useId();
  const originalsId = useId();
  if (!status.data?.enabled || !chat.data?.on) return null;
  const customer = customerLanguageOf(chat.data);
  const outgoing = outgoingLanguageOf(chat.data, true);
  const same = !isGroup && customer === my;
  const customerLabel = customer
    ? chat.data.mixed && !chat.data.customerLanguage
      ? `${NATIVE[customer]} + ${NATIVE[chat.data.mixed]}`
      : NATIVE[customer]
    : t('liveTranslate.bar.unknown');
  const notice = !online
    ? { tone: 'warning' as const, text: t('liveTranslate.bar.offline') }
    : !status.data.connected
      ? { tone: 'warning' as const, text: t('liveTranslate.bar.noConnection') }
      : status.data.dailyLimit > 0 && status.data.usedToday >= status.data.dailyLimit
        ? { tone: 'warning' as const, text: t('liveTranslate.bar.limit') }
        : same
          ? { tone: 'info' as const, text: t('liveTranslate.bar.same') }
          : !isGroup && !customer
            ? { tone: 'info' as const, text: t('liveTranslate.bar.notDetected') }
            : null;
  return (
    <div
      className="border-b bg-accent/40 px-3 py-1.5 text-sm md:px-4"
      data-testid="translate-bar"
      role="region"
      aria-label={t('liveTranslate.bar.label')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-accent-foreground">
          <Languages className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {isGroup
              ? t('liveTranslate.bar.groupPair', {
                  my: NATIVE[my],
                  out: outgoing ? NATIVE[outgoing] : NATIVE[my],
                })
              : t('liveTranslate.bar.pair', { customer: customerLabel, my: NATIVE[my] })}
          </span>
          {!isGroup && !chat.data.customerLanguage && customer && (
            <span className="shrink-0 text-xs font-normal text-muted-foreground">
              {t('liveTranslate.bar.detected')}
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
            {t('liveTranslate.bar.showOriginals')}
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-touch"
                aria-label={t('liveTranslate.bar.languages')}
                title={t('liveTranslate.bar.languages')}
                data-testid="translate-languages"
                className="text-muted-foreground"
              >
                <Settings2 className="size-4" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-4">
              <p className="text-sm font-semibold">{t('liveTranslate.bar.languagesTitle')}</p>
              {isGroup ? (
                <div className="space-y-1.5">
                  <Label htmlFor={outId}>{t('liveTranslate.bar.groupGets')}</Label>
                  <LanguageSelect
                    id={outId}
                    value={chat.data.outgoingLanguage ?? 'auto'}
                    autoLabel={
                      chat.data.outgoingDetected
                        ? t('liveTranslate.bar.autoCommon', {
                            lang: NATIVE[chat.data.outgoingDetected],
                          })
                        : t('liveTranslate.bar.auto')
                    }
                    onChange={(v) => set.mutate({ outgoingLanguage: v === 'auto' ? null : v })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('liveTranslate.bar.groupHelp')}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor={customerId}>{t('liveTranslate.bar.customerWrites')}</Label>
                  <LanguageSelect
                    id={customerId}
                    value={chat.data.customerLanguage ?? 'auto'}
                    autoLabel={
                      chat.data.detected
                        ? t('liveTranslate.bar.autoDetected', { lang: NATIVE[chat.data.detected] })
                        : t('liveTranslate.bar.auto')
                    }
                    onChange={(v) => set.mutate({ customerLanguage: v === 'auto' ? null : v })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('liveTranslate.bar.customerHelp')}
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor={myId}>{t('liveTranslate.bar.youWrite')}</Label>
                <LanguageSelect
                  id={myId}
                  value={my}
                  onChange={(v) => v !== 'auto' && setMe.mutate({ translateLanguage: v })}
                />
                <p className="text-xs text-muted-foreground">{t('liveTranslate.bar.youHelp')}</p>
              </div>
              <p className="text-xs text-muted-foreground" data-testid="translate-usage">
                {status.data.dailyLimit > 0
                  ? t('liveTranslate.bar.usage', {
                      used: status.data.usedToday,
                      limit: status.data.dailyLimit,
                    })
                  : t('liveTranslate.bar.usageNoLimit', { used: status.data.usedToday })}
              </p>
              <Button
                variant="outline"
                size="touch"
                className="w-full"
                onClick={() => set.mutate({ on: false })}
                data-testid="translate-off"
              >
                {t('liveTranslate.bar.turnOff')}
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {isGroup && (
        <p className="pb-0.5 text-xs text-muted-foreground">{t('liveTranslate.bar.groupNote')}</p>
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

/**
 * Off, in a direct chat whose customer writes another language: a one-line hint above the composer. A hint only;
 * Live translate never turns itself on.
 */
export function TranslateHint({ jid, isGroup }: { jid: string; isGroup: boolean }) {
  const { t } = useTranslation('inbox');
  const status = useLiveTranslateStatus();
  const chat = useChatTranslate(jid);
  const set = useSetChatTranslate(jid);
  const { myLanguage: my } = useMyTranslate();
  const [closed, setClosed] = useState(false);
  const customer = customerLanguageOf(chat.data);
  if (
    closed ||
    isGroup ||
    !status.data?.enabled ||
    !status.data.connected ||
    !chat.data ||
    chat.data.on ||
    !customer ||
    customer === my
  )
    return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2 text-sm text-muted-foreground"
      data-testid="translate-hint"
    >
      <Languages className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0">
        {t('liveTranslate.hint.text', { customer: NATIVE[customer] })}
      </span>
      <span aria-hidden="true">·</span>
      <Button size="sm" variant="outline" onClick={() => set.mutate({ on: true })}>
        {t('liveTranslate.buttonShort')}
      </Button>
      <Button
        variant="ghost"
        size="icon-touch"
        className="ml-auto size-8 text-muted-foreground"
        aria-label={t('liveTranslate.hint.dismiss')}
        title={t('liveTranslate.hint.dismiss')}
        onClick={() => setClosed(true)}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

/** A small line under the text, with a link that shows the other version. */
function TranslationLine({
  label,
  toggle,
  open,
  onToggle,
  tone = 'muted',
}: {
  label: string;
  toggle?: string;
  open?: boolean;
  onToggle?(): void;
  tone?: 'muted' | 'warning';
}) {
  return (
    <p
      className={cn(
        'mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px]',
        tone === 'warning' ? 'text-warning' : 'text-muted-foreground',
      )}
    >
      {tone === 'warning' ? (
        <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <Languages className="size-3 shrink-0" aria-hidden="true" />
      )}
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

/** The other version of a message, under the line (the original, the sent text or what was typed). */
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
 * The text of a bubble. On: the message in my language (what I typed for my own replies), with the other version
 * one tap away. Off: the real message, plus "Written in …" on a reply that went through Live translate.
 */
export function BubbleText({
  m,
  render,
  className,
}: {
  m: TranslatableMessage;
  render(text: string): React.ReactNode;
  className?: string;
}) {
  const { t } = useTranslation('inbox');
  const found = useBubbleTranslation(m);
  const [open, setOpen] = useState<boolean | null>(null);
  const body = m.body ?? '';
  const main = (text: string, lang?: string) => (
    <p
      lang={lang}
      className={cn(
        'whitespace-pre-wrap break-words text-[15px] leading-snug [overflow-wrap:anywhere]',
        className,
      )}
    >
      {render(text)}
    </p>
  );
  // Without the chat's context (a quote, a test) the text shows as it is.
  if (!found) return main(body);
  const { ctx, tr } = found;
  const expanded = open ?? ctx.showOriginals;
  const flip = () => setOpen(!expanded);
  if (m.sentOriginal)
    return (
      <div data-testid="bubble-sent-original">
        {main(body)}
        {ctx.active && <TranslationLine label={t('liveTranslate.bubble.sentOriginal')} />}
      </div>
    );
  const typed = m.typed;
  if (typed) {
    // On, and I read the language it was typed in: what was typed, with what the customer got one tap away.
    if (ctx.active && typed.typedLanguage === ctx.my)
      return (
        <div data-testid="bubble-written-mine">
          {main(typed.typedText, typed.typedLanguage)}
          <TranslationLine
            label={t('liveTranslate.bubble.sentIn', { lang: NATIVE[typed.sentLanguage] })}
            toggle={expanded ? t('liveTranslate.bubble.hide') : t('liveTranslate.bubble.showSent')}
            open={expanded}
            onToggle={flip}
          />
          {expanded && (
            <OtherVersion
              label={t('liveTranslate.bubble.sentLabel')}
              text={body}
              lang={typed.sentLanguage}
            />
          )}
        </div>
      );
    return (
      <div data-testid="bubble-written">
        {main(body, typed.sentLanguage)}
        <TranslationLine
          label={t('liveTranslate.bubble.writtenIn', { lang: NATIVE[typed.typedLanguage] })}
          toggle={expanded ? t('liveTranslate.bubble.hide') : t('liveTranslate.bubble.showTyped')}
          open={expanded}
          onToggle={flip}
        />
        {expanded && (
          <OtherVersion
            label={
              typed.edited
                ? t('liveTranslate.bubble.typedEdited')
                : t('liveTranslate.bubble.typedLabel')
            }
            text={typed.typedText}
            lang={typed.typedLanguage}
          />
        )}
      </div>
    );
  }
  if (!ctx.active) return main(body);
  if (tr?.kind === 'translated')
    // Our replies without a typed record (the AI agent's, the phone's) read "Sent in …".
    return (
      <div data-testid="bubble-translated">
        {main(tr.text, ctx.my)}
        <TranslationLine
          label={
            m.fromMe
              ? t('liveTranslate.bubble.sentIn', { lang: NATIVE[tr.from] })
              : t('liveTranslate.bubble.translatedFrom', { lang: NATIVE[tr.from] })
          }
          toggle={
            expanded
              ? t('liveTranslate.bubble.hide')
              : m.fromMe
                ? t('liveTranslate.bubble.showSent')
                : t('liveTranslate.bubble.showOriginal')
          }
          open={expanded}
          onToggle={flip}
        />
        {expanded && (
          <OtherVersion
            label={
              m.fromMe
                ? t('liveTranslate.bubble.sentLabel')
                : t('liveTranslate.bubble.originalLabel')
            }
            text={body}
            lang={tr.from}
          />
        )}
      </div>
    );
  if (tr?.kind === 'failed') {
    const canRetry = tr.code === 'error' || tr.code === 'offline';
    return (
      <div data-testid="bubble-failed">
        {main(body, tr.from)}
        <TranslationLine
          tone="warning"
          label={t(`liveTranslate.bubble.failed.${tr.code}`)}
          toggle={canRetry ? t('liveTranslate.bubble.retry') : undefined}
          onToggle={canRetry ? ctx.retry : undefined}
        />
      </div>
    );
  }
  // Just arrived: the original until its translation comes.
  if (!tr && ctx.pending && !m.fromMe && !m.id.startsWith('local-'))
    return (
      <div>
        {main(body)}
        <p
          className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"
          role="status"
        >
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          {t('liveTranslate.bubble.translating')}
        </p>
      </div>
    );
  return main(body);
}

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'ready'; result: Extract<TranslateDraft, { status: 'ok' }> }
  | { kind: 'refused'; item: string; became: string }
  | { kind: 'error'; code: string };

const ERROR_KEY: Record<string, 'limit' | 'noAi' | 'offline' | 'off'> = {
  translate_limit: 'limit',
  ai_unavailable: 'noAi',
  network: 'offline',
  translate_off: 'off',
};

/** What "Send" hands to the conversation: the checked text and the record the server keeps beside it. */
export interface PreviewSend {
  text: string;
  typedText: string;
  edited: boolean;
  draftId: string;
}

/**
 * "Customer will get · 中文": the translation, the protected items kept, Send / Edit translation / Send original
 * instead. With "Send without preview" on it sends as soon as the translation passes the check, and stays only when
 * something went wrong. Nothing is sent until the person presses a send button (or chose to skip the preview).
 */
export function SendPreview({
  jid,
  typed,
  my,
  customer,
  dailyLimit,
  autoSend,
  onSend,
  onSendOriginal,
  onDiscard,
}: {
  jid: string;
  typed: string;
  my: Lang;
  customer: Lang;
  dailyLimit: number;
  autoSend: boolean;
  onSend(send: PreviewSend): void;
  onSendOriginal(text: string): void;
  onDiscard(): void;
}) {
  const { t } = useTranslation('inbox');
  const [mine, setMine] = useState(typed);
  const [editingMine, setEditingMine] = useState(false);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  const [draft, setDraft] = useState('');
  const [round, setRound] = useState(0);
  const sendRef = useRef<HTMLButtonElement>(null);
  const textId = useId();
  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    setEditing(false);
    translateDraft(jid, { text: mine, target: customer }).then(
      (result) => {
        if (!live) return;
        if (result.status === 'refused')
          return setState({ kind: 'refused', item: result.item, became: result.became });
        if (autoSend && round === 0)
          return onSend({
            text: result.translation,
            typedText: mine,
            edited: false,
            draftId: result.draftId,
          });
        setDraft(result.translation);
        setState({ kind: 'ready', result });
      },
      (err: unknown) =>
        live && setState({ kind: 'error', code: err instanceof ApiError ? err.code : 'error' }),
    );
    return () => {
      live = false;
    };
    // Re-run only on Try again / Translate again (round), not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);
  useEffect(() => {
    if (state.kind === 'ready' && !editing) sendRef.current?.focus();
  }, [state.kind, editing]);
  const edited = state.kind === 'ready' && draft.trim() !== state.result.translation.trim();
  const send = () =>
    state.kind === 'ready' &&
    draft.trim() &&
    onSend({ text: draft.trim(), typedText: mine, edited, draftId: state.result.draftId });
  return (
    <section
      className="mb-2 rounded-xl border bg-surface shadow-sm"
      aria-label={t('liveTranslate.preview.title', { lang: NATIVE[customer] })}
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
        <p className="flex-1 text-sm font-semibold">
          {t('liveTranslate.preview.title', { lang: NATIVE[customer] })}
        </p>
        <Button
          variant="ghost"
          size="icon-touch"
          onClick={onDiscard}
          aria-label={t('liveTranslate.preview.close')}
          title={t('liveTranslate.preview.close')}
          className="text-muted-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="max-h-[45dvh] space-y-2 overflow-y-auto px-3 py-2">
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t('liveTranslate.preview.youWrote', { lang: NATIVE[my] })}
            </p>
            {!editingMine && (
              <Button
                variant="link"
                className="h-auto p-0 text-xs pointer-coarse:min-h-8"
                onClick={() => setEditingMine(true)}
              >
                {t('liveTranslate.preview.editMine')}
              </Button>
            )}
          </div>
          {editingMine ? (
            <div className="mt-1 space-y-1.5">
              <Textarea
                value={mine}
                onChange={(e) => setMine(e.target.value)}
                lang={my}
                aria-label={t('liveTranslate.preview.youWrote', { lang: NATIVE[my] })}
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
                {t('liveTranslate.preview.translateAgain')}
              </Button>
            </div>
          ) : (
            <p
              lang={my}
              className="whitespace-pre-wrap break-words text-sm text-muted-foreground [overflow-wrap:anywhere]"
            >
              {mine}
            </p>
          )}
        </div>
        {state.kind === 'loading' && (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {autoSend
              ? t('liveTranslate.preview.sending', { lang: NATIVE[customer] })
              : t('liveTranslate.preview.translating', { lang: NATIVE[customer] })}
          </p>
        )}
        {state.kind === 'ready' && (
          <div className="space-y-1.5">
            {editing ? (
              <>
                <Label htmlFor={textId} className="text-xs font-medium text-muted-foreground">
                  {t('liveTranslate.preview.editLabel')}
                </Label>
                <Textarea
                  id={textId}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  lang={customer}
                  autoFocus
                  className="min-h-16 bg-outbound text-[15px] text-outbound-foreground"
                  data-testid="translate-preview-text"
                />
              </>
            ) : (
              <p
                lang={customer}
                className="whitespace-pre-wrap break-words rounded-lg border border-primary/15 bg-outbound px-3 py-2 text-[15px] text-outbound-foreground [overflow-wrap:anywhere]"
                data-testid="translate-preview-result"
              >
                {draft}
                {edited && (
                  <Badge variant="secondary" className="ml-2 align-middle text-[11px]">
                    {t('liveTranslate.preview.edited')}
                  </Badge>
                )}
              </p>
            )}
            {state.result.protected.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                <Check className="size-3.5 text-primary" aria-hidden="true" />
                {t('liveTranslate.preview.kept')}
                {state.result.protected.map((item) => (
                  <Badge key={item} variant="secondary" className="font-normal">
                    {item}
                  </Badge>
                ))}
              </p>
            )}
          </div>
        )}
        {state.kind === 'refused' && (
          <Banner tone="warning" title={t('liveTranslate.preview.refusedTitle')}>
            {t('liveTranslate.preview.refused', { item: state.item, became: state.became })}
          </Banner>
        )}
        {state.kind === 'error' && (
          <Banner tone={state.code === 'translate_limit' ? 'warning' : 'danger'}>
            {t(`liveTranslate.preview.errors.${ERROR_KEY[state.code] ?? ('error' as const)}`, {
              count: dailyLimit,
            })}
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
          {t('liveTranslate.preview.sendOriginal')}
        </Button>
        {(state.kind === 'refused' || state.kind === 'error') && (
          <Button variant="outline" size="touch" onClick={() => setRound((n) => n + 1)}>
            <RotateCw aria-hidden="true" />
            {t('liveTranslate.preview.retry')}
          </Button>
        )}
        {state.kind === 'ready' && (
          <Button
            variant="outline"
            size="touch"
            onClick={() => setEditing((e) => !e)}
            data-testid="translate-edit"
          >
            {editing ? <Check aria-hidden="true" /> : <Pencil aria-hidden="true" />}
            {editing ? t('liveTranslate.preview.done') : t('liveTranslate.preview.edit')}
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
          {t('liveTranslate.preview.send')}
        </Button>
      </div>
    </section>
  );
}
