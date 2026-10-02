import { useEffect, useState } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ErrorState, Field, Pending } from './adminUi';

export function SettingsPage() {
  const settings = useSettings();
  const patch = usePatchSettings();

  const [port, setPort] = useState('');
  const [lanEnabled, setLanEnabled] = useState(false);
  const [historyDays, setHistoryDays] = useState('');
  const [restartRequired, setRestartRequired] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setPort(String(settings.data.port));
    setLanEnabled(settings.data.lanEnabled);
    setHistoryDays(String(settings.data.historyDays));
  }, [settings.data]);

  if (settings.isPending)
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (settings.isError)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  const cur = settings.data;
  const portNum = Number(port);
  const daysNum = Number(historyDays);
  const portError =
    !Number.isInteger(portNum) || portNum < 1024 || portNum > 65535
      ? 'Port must be between 1024 and 65535.'
      : undefined;
  const daysError =
    !Number.isInteger(daysNum) || daysNum < 0 || daysNum > 365
      ? 'History must be between 0 and 365 days.'
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
        toast.success('Settings saved.');
        if (r.restartRequired || needsRestart) setRestartRequired(true);
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" />

      {restartRequired && (
        <Banner tone="warning" title="Restart required">
          Network changes take effect after the app (or service) restarts.
        </Banner>
      )}

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Card className="gap-4">
          <CardHeader>
            <CardTitle>Network</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field label="Port" error={portError} hint="Default 7420.">
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
                  Allow access from the local network (LAN)
                </Label>
                <p id="settings-lan-desc" className="mt-0.5 text-sm text-muted-foreground">
                  Other devices on the same Wi-Fi can open the inbox.
                </p>
              </div>
              {/* 44px hit area around the compact switch. */}
              <span className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center">
                <Switch
                  id="settings-lan"
                  aria-describedby="settings-lan-desc"
                  checked={lanEnabled}
                  onCheckedChange={setLanEnabled}
                />
              </span>
            </div>
            {lanEnabled && (
              <Banner tone="warning" title="LAN traffic is plain HTTP">
                Passwords and messages travel unencrypted on your local network. Only enable this on
                a network you trust; use the tunnel for encrypted remote access.
              </Banner>
            )}
          </CardContent>
        </Card>

        <Card className="gap-4">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="Days of history to import when linking" error={daysError}>
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
            Save settings
          </Button>
        </div>
      </form>

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>This device</CardTitle>
          <CardDescription>Get a notification for new messages when the inbox isn't open.</CardDescription>
        </CardHeader>
        <CardContent>
          <PushToggle />
        </CardContent>
      </Card>
    </div>
  );
}
