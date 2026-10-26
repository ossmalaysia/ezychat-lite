import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BookText, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  ReplyPhrase as ReplyPhraseSchema,
  ReplyPhraseLanguage,
  ReplyPhraseStatus,
  type ReplyPhrase,
} from '@ezychat/shared';
import { useAiAgents } from '../api/ai';
import { api, errorMessage } from '../api/client';
import {
  phrasesAdminKey,
  usePhrasesAdmin,
  useReplySuggestionsStatus,
} from '../api/reply-suggestions';
import { formatRelative } from '@/lib/format';
import { Banner } from '@/components/app';
import { SearchField } from '@/components/app/SearchField';
import { SegmentedControl } from '@/components/app/SegmentedControl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Field } from './adminUi';

const LANGUAGES = ReplyPhraseLanguage.options;

/**
 * Settings → AI: the team's phrase list for instant grey text (design:
 * docs/features/ai-phrase-dictionary/design.md). The AI builds it in the background; admins see its
 * state, rebuild it and add, edit or delete phrases. With several AI agents, one list per agent.
 */
export function PhraseDictionarySection() {
  const { t } = useTranslation('admin');
  const client = useQueryClient();
  const suggest = useReplySuggestionsStatus();
  const agents = useAiAgents();
  const [agentId, setAgentId] = useState<number | null>(null);
  const query = usePhrasesAdmin(agentId);
  const [open, setOpen] = useState(false);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: phrasesAdminKey });
    // Every composer reloads its list.
    void client.invalidateQueries({ queryKey: ['ai', 'phraseList'] });
  };
  const shownAgent = agentId ?? query.data?.agentId ?? null;
  const rebuild = useMutation({
    mutationFn: () =>
      api('/ai/phrases/rebuild', {
        method: 'POST',
        body: shownAgent === null ? {} : { agentId: shownAgent },
        schema: ReplyPhraseStatus,
      }),
    onSuccess: refresh,
  });
  const status = query.data?.status;
  const off = suggest.data !== undefined && suggest.data.state === 'off';
  const list = agents.data?.agents ?? [];

  return (
    <Card data-testid="phrase-dictionary-settings">
      <CardHeader>
        <CardTitle>{t('settings.phrases.title')}</CardTitle>
        <CardDescription>{t('settings.phrases.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.length > 1 && (
          <Field label={t('settings.phrases.agent')}>
            {(p) => (
              <Select
                value={shownAgent === null ? undefined : String(shownAgent)}
                onValueChange={(v) => setAgentId(Number(v))}
              >
                <SelectTrigger {...p} className="min-h-11 w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {list.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        )}
        {off && <Banner tone="info">{t('settings.phrases.off')}</Banner>}
        {status?.state === 'building' && (
          <div className="flex items-center gap-2 text-sm" role="status">
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
            {t('settings.phrases.building')}
          </div>
        )}
        {status?.state === 'empty' && (
          <p className="text-sm text-muted-foreground">{t('settings.phrases.empty')}</p>
        )}
        {status?.state === 'error' && <Banner tone="danger">{t('settings.phrases.error')}</Banner>}
        {status &&
          (status.state === 'ready' || (status.state === 'building' && status.count > 0)) && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">
                {t('settings.phrases.count', { count: status.count })}
              </p>
              {status.languages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {status.languages.map((l) => (
                    <Badge key={l.language} variant="secondary">
                      {t(`settings.phrases.lang.${l.language}`)} · {l.count}
                    </Badge>
                  ))}
                </div>
              )}
              {status.updatedAt !== null && (
                <p className="text-sm text-muted-foreground">
                  {t('settings.phrases.updated', { when: formatRelative(status.updatedAt) })}{' '}
                  {status.trigger ? t(`settings.phrases.trigger.${status.trigger}`) : ''}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                {t('settings.phrases.next', {
                  count: Math.max(1, status.nextAfterReplies - status.newReplies),
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('settings.phrases.calls', {
                  used: status.aiCallsToday,
                  limit: status.aiCallsLimit,
                })}
              </p>
            </div>
          )}
        {(query.error || rebuild.error) && (
          <Banner tone="danger">{errorMessage(query.error || rebuild.error)}</Banner>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="touch"
            variant="outline"
            disabled={!status || status.count === 0}
            onClick={() => setOpen(true)}
          >
            <BookText aria-hidden />
            {t('settings.phrases.view')}
          </Button>
          <Button
            size="touch"
            variant="outline"
            disabled={!status || status.state === 'building' || rebuild.isPending || off}
            onClick={() => rebuild.mutate()}
          >
            <RefreshCw aria-hidden />
            {status?.state === 'empty'
              ? t('settings.phrases.build')
              : t('settings.phrases.rebuild')}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t('settings.phrases.privacy')}</p>
      </CardContent>
      <PhraseListDialog
        open={open}
        onOpenChange={setOpen}
        agentId={shownAgent}
        phrases={query.data?.phrases ?? []}
        onChanged={refresh}
      />
    </Card>
  );
}

function PhraseListDialog({
  open,
  onOpenChange,
  agentId,
  phrases,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: number | null;
  phrases: ReplyPhrase[];
  onChanged: () => void;
}) {
  const { t } = useTranslation('admin');
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState<ReplyPhraseLanguage | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const filterId = useId();
  const needle = search.trim().toLowerCase();
  const shown = phrases.filter(
    (p) => (language === 'all' || p.language === language) && p.text.toLowerCase().includes(needle),
  );
  const remove = useMutation({
    mutationFn: (id: number) => api(`/ai/phrases/${id}`, { method: 'DELETE' }),
    onSuccess: onChanged,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl" data-testid="phrase-list">
        <DialogHeader>
          <DialogTitle>{t('settings.phrases.listTitle')}</DialogTitle>
          <DialogDescription>{t('settings.phrases.listDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t('settings.phrases.search')}
            label={t('settings.phrases.search')}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span id={filterId} className="sr-only">
              {t('settings.phrases.language')}
            </span>
            <SegmentedControl<ReplyPhraseLanguage | 'all'>
              size="sm"
              aria-labelledby={filterId}
              value={language}
              onValueChange={setLanguage}
              options={[
                { value: 'all', label: t('settings.phrases.all') },
                ...LANGUAGES.map((l) => ({ value: l, label: t(`settings.phrases.lang.${l}`) })),
              ]}
            />
            <Button
              size="touch"
              variant="outline"
              onClick={() => setAdding(true)}
              disabled={adding}
            >
              <Plus aria-hidden />
              {t('settings.phrases.add')}
            </Button>
          </div>
          {adding && (
            <PhraseEditor
              agentId={agentId}
              onDone={() => {
                setAdding(false);
                onChanged();
              }}
              onCancel={() => setAdding(false)}
            />
          )}
          {remove.error && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
        </div>
        <ul className="-mx-1 min-h-0 flex-1 divide-y overflow-y-auto px-1">
          {shown.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">
              {t('settings.phrases.noMatch')}
            </li>
          )}
          {shown.map((phrase) =>
            editing === phrase.id ? (
              <li key={phrase.id} className="py-3">
                <PhraseEditor
                  agentId={agentId}
                  phrase={phrase}
                  onDone={() => {
                    setEditing(null);
                    onChanged();
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={phrase.id} className="flex items-start gap-2 py-3" data-testid="phrase-row">
                <div className="min-w-0 flex-1">
                  <p className="text-sm break-words">{phrase.text}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <Badge variant="outline">{t(`settings.phrases.source.${phrase.source}`)}</Badge>
                    <span>{t(`settings.phrases.lang.${phrase.language}`)}</span>
                    <span>{t('settings.phrases.uses', { count: phrase.uses })}</span>
                    {phrase.fact && <span>{t('settings.phrases.fact')}</span>}
                  </div>
                </div>
                <Button
                  size="icon-touch"
                  variant="ghost"
                  aria-label={t('settings.phrases.edit')}
                  onClick={() => setEditing(phrase.id)}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  size="icon-touch"
                  variant="ghost"
                  aria-label={t('settings.phrases.delete')}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(phrase.id)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ),
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function PhraseEditor({
  agentId,
  phrase,
  onDone,
  onCancel,
}: {
  agentId: number | null;
  phrase?: ReplyPhrase;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('admin');
  const [text, setText] = useState(phrase?.text ?? '');
  const [language, setLanguage] = useState<ReplyPhraseLanguage>(phrase?.language ?? 'en');
  const textId = useId();
  const save = useMutation({
    mutationFn: () =>
      phrase
        ? api(`/ai/phrases/${phrase.id}`, {
            method: 'PUT',
            body: { text, language },
            schema: ReplyPhraseSchema,
          })
        : api('/ai/phrases', {
            method: 'POST',
            body: { text, language, ...(agentId === null ? {} : { agentId }) },
            schema: ReplyPhraseSchema,
          }),
    onSuccess: onDone,
  });
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3"
      data-testid="phrase-editor"
    >
      <label htmlFor={textId} className="text-sm font-medium">
        {phrase ? t('settings.phrases.edit') : t('settings.phrases.add')}
      </label>
      <Textarea
        id={textId}
        value={text}
        rows={2}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={language} onValueChange={(v) => setLanguage(ReplyPhraseLanguage.parse(v))}>
          <SelectTrigger className="min-h-11 w-44" aria-label={t('settings.phrases.language')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l} value={l}>
                {t(`settings.phrases.lang.${l}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="touch"
          disabled={text.trim().length < 3 || save.isPending}
          onClick={() => save.mutate()}
        >
          {t('settings.phrases.save')}
        </Button>
        <Button size="touch" variant="ghost" onClick={onCancel}>
          {t('settings.phrases.cancel')}
        </Button>
      </div>
      {save.error && <Banner tone="danger">{errorMessage(save.error)}</Banner>}
    </div>
  );
}
