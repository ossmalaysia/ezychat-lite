import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ReplySuggestionsStatus } from '@ezychat/shared';
import { api, errorMessage } from '../api/client';
import { replySuggestionsKey, useReplySuggestionsStatus } from '../api/reply-suggestions';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SaveBar } from './adminUi';

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
  const dirty = draft !== undefined && draft !== query.data?.enabled;
  const save = useMutation({
    mutationFn: (next: boolean) =>
      api('/ai/reply-suggestions', {
        method: 'PUT',
        body: { enabled: next },
        schema: ReplySuggestionsStatus,
      }),
    onSuccess: (data) => {
      client.setQueryData(replySuggestionsKey, data);
      setDraft(undefined);
    },
  });
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
        {(save.error || query.error) && (
          <Banner tone="danger">{errorMessage(save.error || query.error)}</Banner>
        )}
        <SaveBar dirty={dirty}>
          <Button
            size="touch"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(enabled)}
          >
            {t('settings.save')}
          </Button>
        </SaveBar>
      </CardContent>
    </Card>
  );
}
