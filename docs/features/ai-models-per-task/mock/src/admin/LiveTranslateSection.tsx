import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLiveTranslateStatus, type LiveTranslateStatus } from '@/mock/liveTranslate';
import { SaveBar } from './adminUi';

interface Draft {
  enabled: boolean;
  dailyLimit: string;
}

/**
 * Proposed (live-translate): Settings → AI card. The team switch (on by default: all staff may use it; each person
 * turns it on per chat) and a per-person daily limit (default 200). It uses the "Model for suggestions".
 * Audited before/after as `settings.live_translate`.
 */
export function LiveTranslateSection() {
  const { t } = useTranslation('admin');
  const client = useQueryClient();
  const query = useLiveTranslateStatus();
  const [draft, setDraft] = useState<Draft>();
  const data = query.data;
  const current: Draft | undefined = data && {
    enabled: data.enabled,
    dailyLimit: String(data.dailyLimit),
  };
  const value = draft ?? current;
  const limitValid = value ? /^\d{1,5}$/.test(value.dailyLimit) : true;
  const dirty =
    !!draft &&
    !!current &&
    (draft.enabled !== current.enabled || draft.dailyLimit !== current.dailyLimit);
  const limitId = useId();
  const limitHelpId = useId();
  const save = useMutation({
    mutationFn: (d: Draft) =>
      api<LiveTranslateStatus>('/mock/live-translate/settings', {
        method: 'PUT',
        body: { enabled: d.enabled, dailyLimit: Number(d.dailyLimit) },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['mock', 'live-translate'] });
      setDraft(undefined);
    },
  });
  const change = (patch: Partial<Draft>) => value && setDraft({ ...value, ...patch });
  return (
    <Card data-testid="live-translate-settings">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>{t('mockTranslate.title')}</CardTitle>
          <Badge variant="outline">{t('mockTranslate.proposed')}</Badge>
        </div>
        <CardDescription>{t('mockTranslate.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="live-translate-enabled">{t('mockTranslate.enable')}</Label>
            <p className="mt-1 text-sm text-muted-foreground">{t('mockTranslate.enableHelp')}</p>
          </div>
          <Label
            htmlFor="live-translate-enabled"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
          >
            <Switch
              id="live-translate-enabled"
              checked={value?.enabled ?? false}
              onCheckedChange={(enabled) => change({ enabled })}
              disabled={!value}
            />
          </Label>
        </div>
        {data && !data.connected && value?.enabled && (
          <Banner tone="info">{t('mockTranslate.noConnection')}</Banner>
        )}
        {value?.enabled && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={limitId}>{t('mockTranslate.limit')}</Label>
              <Input
                id={limitId}
                inputMode="numeric"
                value={value.dailyLimit}
                aria-invalid={!limitValid}
                aria-describedby={limitHelpId}
                onChange={(e) => change({ dailyLimit: e.target.value.trim() })}
                className="h-11 md:h-9"
              />
            </div>
            <p id={limitHelpId} className="text-sm text-muted-foreground sm:col-span-2">
              {t('mockTranslate.limitHelp')}
            </p>
          </div>
        )}
        <div className="space-y-1 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          <p>{t('mockTranslate.privacy')}</p>
          <p>{t('mockTranslate.languages')}</p>
          {data && (
            <p className="font-medium text-foreground" data-testid="live-translate-usage">
              {t('mockTranslate.usage', { count: data.usedToday, people: data.peopleToday })}
            </p>
          )}
        </div>
        {(save.error || query.error) && (
          <Banner tone="danger">{errorMessage(save.error || query.error)}</Banner>
        )}
        <SaveBar dirty={dirty}>
          <Button
            size="touch"
            disabled={!dirty || !limitValid || save.isPending}
            onClick={() => value && save.mutate(value)}
          >
            {t('settings.save')}
          </Button>
        </SaveBar>
      </CardContent>
    </Card>
  );
}
