import { useState } from 'react';
import type React from 'react';
import { toast } from 'sonner';
import type { SettingsPatchBody } from '@wa-team-inbox/shared';
import { errorMessage } from '../api/client';
import { usePatchSettings, useSettings } from '../api/queries';
import { PushToggle } from '../pwa/PushToggle';
import { Banner, PageHeader } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { THEME_OPTIONS, useTheme } from '@/lib/theme';
import { useTranslation } from 'react-i18next';
import { ErrorState, Field, Pending } from './adminUi';
import { ResolveAllChatsCard } from './ResolveAllChatsCard';
import { AiMemberPanel } from './AiMemberPanel';

export function SettingsPage() {
  const settings = useSettings();
  const patch = usePatchSettings();
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation(['admin', 'common']);

  const [portDraft, setPort] = useState<string>();
  const [lanDraft, setLanEnabled] = useState<boolean>();
  const [historyDraft, setHistoryDays] = useState<string>();
  const [restartRequired, setRestartRequired] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  if (settings.isPending)
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label={t('ui.loading')}>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (settings.isError)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  const cur = settings.data;
  const port = portDraft ?? String(cur.port);
  const lanEnabled = lanDraft ?? cur.lanEnabled;
  const historyDays = historyDraft ?? String(cur.historyDays);
  const portNum = Number(port);
  const daysNum = Number(historyDays);
  const portError =
    !Number.isInteger(portNum) || portNum < 1024 || portNum > 65535
      ? t('settings.portInvalid')
      : undefined;
  const daysError =
    !Number.isInteger(daysNum) || daysNum < 0 || daysNum > 365
      ? t('settings.historyInvalid')
      : undefined;

  const body: SettingsPatchBody = {};
  if (!portError && portNum !== cur.port) body.port = portNum;
  if (lanEnabled !== cur.lanEnabled) body.lanEnabled = lanEnabled;
  if (!daysError && daysNum !== cur.historyDays) body.historyDays = daysNum;
  const dirty = Object.keys(body).length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (portError || daysError || !dirty) return;
    const needsRestart = body.port !== undefined || body.lanEnabled !== undefined;
    patch.mutate(body, {
      onSuccess: (r) => {
        toast.success(t('settings.saved'));
        if (r.restartRequired || needsRestart) setRestartRequired(true);
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('settings.title')} />

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>{t('ai.settingsTitle')}</CardTitle>
          <CardDescription>{t('ai.settingsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="touch" onClick={() => setAiOpen(true)}>
            {t('ai.configure')}
          </Button>
        </CardContent>
      </Card>
      {aiOpen && <AiMemberPanel section="connection" onClose={() => setAiOpen(false)} />}

      {restartRequired && (
        <Banner tone="warning" title={t('settings.restartTitle')}>
          {t('settings.restartBody')}
        </Banner>
      )}

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Card className="gap-4">
          <CardHeader>
            <CardTitle>{t('settings.network.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field
              label={t('settings.network.port')}
              error={portError}
              hint={t('settings.network.portHint')}
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={1024}
                  max={65535}
                  className="h-11 md:h-9 md:max-w-48"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              )}
            </Field>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="settings-lan" className="leading-normal">
                  {t('settings.network.lan')}
                </Label>
                <p id="settings-lan-desc" className="mt-0.5 text-sm text-muted-foreground">
                  {t('settings.network.lanHint')}
                </p>
              </div>
              {/* Associate the padded target with the switch so its entire area is tappable. */}
              <Label
                htmlFor="settings-lan"
                className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center"
              >
                <Switch
                  id="settings-lan"
                  aria-describedby="settings-lan-desc"
                  checked={lanEnabled}
                  onCheckedChange={setLanEnabled}
                />
              </Label>
            </div>
            {lanEnabled && (
              <Banner tone="warning" title={t('settings.network.lanWarningTitle')}>
                {t('settings.network.lanWarningBody')}
              </Banner>
            )}
          </CardContent>
        </Card>

        <Card className="gap-4">
          <CardHeader>
            <CardTitle>{t('settings.history.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label={t('settings.history.days')} error={daysError}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={365}
                  className="h-11 md:h-9 md:max-w-48"
                  value={historyDays}
                  onChange={(e) => setHistoryDays(e.target.value)}
                />
              )}
            </Field>
          </CardContent>
        </Card>

        {patch.error && <Banner tone="danger">{errorMessage(patch.error)}</Banner>}

        <div className="flex flex-col sm:flex-row">
          <Button
            type="submit"
            size="touch"
            className="md:min-h-9"
            disabled={patch.isPending || !dirty || !!portError || !!daysError}
          >
            <Pending show={patch.isPending} />
            {t('settings.save')}
          </Button>
        </div>
      </form>

      <ResolveAllChatsCard />

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>{t('settings.device.title')}</CardTitle>
          <CardDescription>{t('settings.device.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div>
            <h3 id="settings-theme-label" className="font-medium">
              {t('common:theme.label')}
            </h3>
            <p id="settings-theme-desc" className="mt-1 text-sm text-muted-foreground">
              {t('settings.device.themeHint')}
            </p>
            <RadioGroup
              aria-labelledby="settings-theme-label"
              aria-describedby="settings-theme-desc"
              value={theme}
              onValueChange={setTheme}
              className="mt-3 grid grid-cols-3 gap-2"
            >
              {THEME_OPTIONS.map((option) => (
                <Label
                  key={option.value}
                  htmlFor={`settings-theme-${option.value}`}
                  className="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-input px-2 py-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent sm:min-h-11 sm:flex-row"
                >
                  <RadioGroupItem id={`settings-theme-${option.value}`} value={option.value} />
                  {t(`common:${option.labelKey}`)}
                </Label>
              ))}
            </RadioGroup>
          </div>
          <div>
            <h3 className="mb-2 font-medium">{t('settings.device.notifications')}</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              {t('settings.device.notificationsHint')}
            </p>
            <PushToggle />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
