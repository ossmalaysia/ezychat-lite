import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ReplySuggestionsStatus } from '@ezychat/shared';
import { api, errorMessage } from '../api/client';
import {
  replySuggestionsKey,
  suggestModelKey,
  useReplySuggestionsStatus,
  useSuggestModel,
} from '../api/reply-suggestions';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Field, SaveBar } from './adminUi';

/**
 * Settings → AI: the team-wide switch for AI reply suggestions. On by default on a new install with
 * an AI connection, off after an update (a note says so); disabled without a connection.
 */
export function ReplySuggestionsSection() {
  const { t } = useTranslation('admin');
  const client = useQueryClient();
  const query = useReplySuggestionsStatus();
  const [draft, setDraft] = useState<boolean>();
  const connected = query.data?.connected ?? false;
  const enabled = draft ?? query.data?.enabled ?? false;
  // Which model answers Suggest reply, the grey text and the phrase build.
  const model = useSuggestModel(connected);
  const [modelDraft, setModelDraft] = useState<string>();
  const savedModel = model.data?.model ?? 'fast';
  // A model the connection no longer lists (the mode changed) answers as Fast on the server too.
  const shownModel =
    modelDraft ??
    (savedModel === 'fast' || savedModel === 'agent' || model.data?.models.includes(savedModel)
      ? savedModel
      : 'fast');
  const switchDirty = draft !== undefined && draft !== query.data?.enabled;
  const modelDirty = modelDraft !== undefined && modelDraft !== model.data?.model;
  const dirty = switchDirty || modelDirty;
  const save = useMutation({
    mutationFn: () =>
      api('/ai/reply-suggestions', {
        method: 'PUT',
        body: {
          ...(switchDirty ? { enabled } : {}),
          ...(modelDirty ? { model: shownModel } : {}),
        },
        schema: ReplySuggestionsStatus,
      }),
    onSuccess: (data) => {
      client.setQueryData(replySuggestionsKey, data);
      void client.invalidateQueries({ queryKey: suggestModelKey });
      setDraft(undefined);
      setModelDraft(undefined);
    },
  });
  const info = model.data;
  return (
    <Card data-testid="reply-suggestions-settings">
      <CardHeader>
        <CardTitle>{t('settings.replySuggestions.title')}</CardTitle>
        <CardDescription>{t('settings.replySuggestions.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {query.data?.upgraded && !query.data.enabled && connected && (
          <Banner tone="info">{t('settings.replySuggestions.upgraded')}</Banner>
        )}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="reply-suggestions-enabled">
              {t('settings.replySuggestions.enable')}
            </Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('settings.replySuggestions.cost')}
            </p>
          </div>
          <Label
            htmlFor="reply-suggestions-enabled"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
          >
            <Switch
              id="reply-suggestions-enabled"
              checked={enabled && connected}
              onCheckedChange={setDraft}
              disabled={query.isPending || !connected}
            />
          </Label>
        </div>
        {query.data && !connected && (
          <Banner tone="warning">{t('settings.replySuggestions.noConnection')}</Banner>
        )}
        {connected && info && (
          <Field
            label={t('settings.replySuggestions.model')}
            hint={
              shownModel === 'fast'
                ? t('settings.replySuggestions.modelFastHint', { model: info.fastModel })
                : t('settings.replySuggestions.modelSlowHint')
            }
          >
            {(p) => (
              <Select value={shownModel} onValueChange={setModelDraft}>
                <SelectTrigger {...p} className="min-h-11 w-full" data-testid="suggest-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">
                    {t('settings.replySuggestions.modelFast', { model: info.fastModel })}
                  </SelectItem>
                  <SelectItem value="agent">
                    {t('settings.replySuggestions.modelAgent', { model: info.agentModel })}
                  </SelectItem>
                  {info.models
                    .filter((id) => id !== info.fastModel)
                    .map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        )}
        {(save.error || query.error || model.error) && (
          <Banner tone="danger">{errorMessage(save.error || query.error || model.error)}</Banner>
        )}
        <SaveBar dirty={dirty}>
          <Button size="touch" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {t('settings.save')}
          </Button>
        </SaveBar>
      </CardContent>
    </Card>
  );
}
