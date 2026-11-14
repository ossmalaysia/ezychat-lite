import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ASK_EZY_DEFAULT_TIMEOUT_MINUTES,
  ASK_EZY_TIMEOUT_MINUTES,
  AskEzySettings,
} from '@ezychat/shared';
import { api, errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Field, SaveBar } from './adminUi';

const askEzySettingsKey = ['ask-ezy-settings'] as const;
type Minutes = AskEzySettings['timeoutMinutes'];

/**
 * Settings → AI: how long Ask Ezy may work on one question (5, 10, 15 or 30 minutes; default 15). Customer
 * replies keep their own limit; the person can always press Stop in the panel.
 */
export function AskEzySettingsSection() {
  const { t } = useTranslation('admin');
  const client = useQueryClient();
  const query = useQuery({
    queryKey: askEzySettingsKey,
    queryFn: () => api('/ask-ezy/settings', { schema: AskEzySettings }),
  });
  const [draft, setDraft] = useState<Minutes>();
  const saved = query.data?.timeoutMinutes ?? ASK_EZY_DEFAULT_TIMEOUT_MINUTES;
  const shown = draft ?? saved;
  const dirty = draft !== undefined && draft !== query.data?.timeoutMinutes;
  const save = useMutation({
    mutationFn: () =>
      api('/ask-ezy/settings', {
        method: 'PUT',
        body: { timeoutMinutes: shown },
        schema: AskEzySettings,
      }),
    onSuccess: (data) => {
      client.setQueryData(askEzySettingsKey, data);
      setDraft(undefined);
    },
  });
  return (
    <Card data-testid="ask-ezy-settings">
      <CardHeader>
        <CardTitle>{t('settings.askEzy.title')}</CardTitle>
        <CardDescription>{t('settings.askEzy.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Field label={t('settings.askEzy.timeout')} hint={t('settings.askEzy.timeoutHint')}>
          {(p) => (
            <Select
              value={String(shown)}
              onValueChange={(v) => setDraft(Number(v) as Minutes)}
              disabled={query.isPending}
            >
              <SelectTrigger {...p} className="min-h-11 w-full" data-testid="ask-ezy-timeout">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASK_EZY_TIMEOUT_MINUTES.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m === ASK_EZY_DEFAULT_TIMEOUT_MINUTES
                      ? t('settings.askEzy.minutesDefault', { count: m })
                      : t('settings.askEzy.minutes', { count: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        {(save.error || query.error) && (
          <Banner tone="danger">{errorMessage(save.error || query.error)}</Banner>
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
