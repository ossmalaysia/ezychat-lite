import { useEffect, useId, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BookOpen, ChevronRight, Plus, X } from 'lucide-react';
import { FixEnglishStatus, TEAM_WORD_CHARACTERS } from '@ezychat/shared';
import { api, errorMessage } from '../api/client';
import {
  addTeamWord,
  fixEnglishKey,
  removeTeamWord,
  teamWordsKey,
  useFixEnglishStatus,
  useTeamWords,
} from '../api/fix-english';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { loadSpeller } from '@/lib/dictionary';
import { LOCAL_WORDS, type Speller } from '@/lib/spelling';
import { SaveBar } from './adminUi';

/** Business context words listed at most (the rest still count). */
const BUSINESS_WORDS_SHOWN = 80;

/**
 * Settings → AI: the team-wide Fix English switch (on by default on a new install, off after an
 * update with a note) and the team words. Spelling needs no AI connection; grammar does.
 */
export function FixEnglishSection() {
  const { t } = useTranslation('admin');
  const client = useQueryClient();
  const query = useFixEnglishStatus();
  const [draft, setDraft] = useState<boolean>();
  const enabled = draft ?? query.data?.enabled ?? false;
  const dirty = draft !== undefined && draft !== query.data?.enabled;
  const save = useMutation({
    mutationFn: () =>
      api('/ai/fix-english', { method: 'PUT', body: { enabled }, schema: FixEnglishStatus }),
    onSuccess: (data) => {
      client.setQueryData(fixEnglishKey, data);
      setDraft(undefined);
    },
  });
  return (
    <Card data-testid="fix-english-settings">
      <CardHeader>
        <CardTitle>{t('settings.fixEnglish.title')}</CardTitle>
        <CardDescription>{t('settings.fixEnglish.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {query.data?.upgraded && !query.data.enabled && (
          <Banner tone="info">{t('settings.fixEnglish.upgraded')}</Banner>
        )}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="fix-english-enabled">{t('settings.fixEnglish.enable')}</Label>
            <p className="mt-1 text-sm text-muted-foreground">{t('settings.fixEnglish.cost')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('settings.fixEnglish.rules')}</p>
          </div>
          <Label
            htmlFor="fix-english-enabled"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
          >
            <Switch
              id="fix-english-enabled"
              checked={enabled}
              onCheckedChange={setDraft}
              disabled={query.isPending}
            />
          </Label>
        </div>
        {query.data && enabled && query.data.grammar === 'none' && (
          <Banner tone="info">{t('settings.fixEnglish.noConnection')}</Banner>
        )}
        {(save.error || query.error) && (
          <Banner tone="danger">{errorMessage(save.error || query.error)}</Banner>
        )}
        <SaveBar dirty={dirty}>
          <Button size="touch" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {t('settings.save')}
          </Button>
        </SaveBar>
        <TeamWords />
      </CardContent>
    </Card>
  );
}

/**
 * Team words: added by any teammate from a marked word, or here; removed here (admins). Below
 * them, the Business context words the dictionary does not know (they change with the context).
 */
function TeamWords() {
  const { t } = useTranslation('admin');
  const client = useQueryClient();
  const words = useTeamWords();
  const [word, setWord] = useState('');
  const inputId = useId();
  const titleId = useId();
  const add = useMutation({
    mutationFn: (value: string) => addTeamWord(value),
    onSuccess: (data) => {
      client.setQueryData(teamWordsKey, data);
      setWord('');
    },
  });
  const remove = useMutation({
    mutationFn: (value: string) => removeTeamWord(value),
    onSuccess: (data) => client.setQueryData(teamWordsKey, data),
  });
  const list = words.data?.words ?? [];
  const business = useUnknownWords(words.data?.businessWords ?? []);
  return (
    <section className="space-y-3 border-t pt-5" aria-labelledby={titleId} data-testid="team-words">
      <div>
        <h3 id={titleId} className="flex items-center gap-2 text-sm font-medium">
          <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('settings.fixEnglish.wordsTitle')}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.fixEnglish.wordsHint')}</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (word.trim()) add.mutate(word.trim());
        }}
      >
        <Label htmlFor={inputId} className="sr-only">
          {t('settings.fixEnglish.wordsLabel')}
        </Label>
        <Input
          id={inputId}
          value={word}
          maxLength={TEAM_WORD_CHARACTERS}
          placeholder={t('settings.fixEnglish.wordsPlaceholder')}
          onChange={(e) => setWord(e.target.value)}
          className="min-h-11 min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="outline"
          size="touch"
          disabled={!word.trim() || add.isPending}
        >
          <Plus aria-hidden="true" />
          {t('settings.fixEnglish.wordsAdd')}
        </Button>
      </form>
      {(add.error || remove.error || words.error) && (
        <Banner tone="danger">{errorMessage(add.error || remove.error || words.error)}</Banner>
      )}
      {words.data && list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('settings.fixEnglish.wordsEmpty')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-labelledby={titleId}>
          {list.map((w) => (
            <li
              key={w.word}
              className="flex max-w-full items-center gap-1 rounded-full border bg-muted py-0.5 pr-0.5 pl-3 text-sm"
            >
              <span className="min-w-0 truncate">{w.word}</span>
              {w.addedBy && (
                <span className="shrink-0 truncate text-xs text-muted-foreground">
                  · {t('settings.fixEnglish.wordsAddedBy', { name: w.addedBy })}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 rounded-full text-muted-foreground pointer-coarse:size-11"
                aria-label={t('settings.fixEnglish.wordsRemove', { word: w.word })}
                disabled={remove.isPending}
                onClick={() => remove.mutate(w.word)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {business.length > 0 && (
        <details className="group rounded-lg border" data-testid="business-words">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-sm">
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
            {t('settings.fixEnglish.businessTitle', { count: business.length })}
          </summary>
          <div className="space-y-2 px-3 pb-3">
            <p className="text-xs text-muted-foreground">{t('settings.fixEnglish.businessHint')}</p>
            <p className="text-sm break-words">
              {business.slice(0, BUSINESS_WORDS_SHOWN).join(', ')}
              {business.length > BUSINESS_WORDS_SHOWN ? ', …' : ''}
            </p>
          </div>
        </details>
      )}
    </section>
  );
}

/** The Business context words the dictionary does not know (loads the dictionary on this page). */
function useUnknownWords(words: readonly string[]): string[] {
  const [speller, setSpeller] = useState<Speller | null>(null);
  useEffect(() => {
    if (!words.length || speller) return;
    let live = true;
    loadSpeller()
      .then((s) => live && setSpeller(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [words.length, speller]);
  return useMemo(
    () =>
      speller
        ? words
            .filter((w) => !LOCAL_WORDS.has(w) && !speller.correct(w))
            .sort((a, b) => a.localeCompare(b))
        : [],
    [speller, words],
  );
}
