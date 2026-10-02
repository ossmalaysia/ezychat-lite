import { useEffect, useState } from 'react';
import type React from 'react';
import type { SettingsPatchBody } from '@wa-team-inbox/shared';
import { errorMessage } from '../api/client';
import { usePatchSettings, useSettings } from '../api/queries';
import { Banner, Button, Card, Input, Spinner } from '../components/legacy';
import { PushToggle } from '../pwa/PushToggle';
import { ErrorState, PageHeader, Toggle } from './adminUi';

export function SettingsPage() {
  const settings = useSettings();
  const patch = usePatchSettings();

  const [port, setPort] = useState('');
  const [lanEnabled, setLanEnabled] = useState(false);
  const [historyDays, setHistoryDays] = useState('');
  const [restartRequired, setRestartRequired] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setPort(String(settings.data.port));
    setLanEnabled(settings.data.lanEnabled);
    setHistoryDays(String(settings.data.historyDays));
  }, [settings.data]);

  if (settings.isPending)
    return (
      <div className="flex justify-center py-10 text-emerald-600">
        <Spinner className="size-6" />
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
    setSaved(false);
    if (portError || daysError || !dirty) return;
    const needsRestart = body.port !== undefined || body.lanEnabled !== undefined;
    patch.mutate(body, {
      onSuccess: (r) => {
        setSaved(true);
        if (r.restartRequired || needsRestart) setRestartRequired(true);
      },
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />

      {restartRequired && (
        <Banner tone="warning" title="Restart required">
          Network changes take effect after the app (or service) restarts.
        </Banner>
      )}

      <form onSubmit={submit} className="space-y-4" noValidate>
        <Card title="Network">
          <div className="space-y-5">
            <Input
              label="Port"
              type="number"
              inputMode="numeric"
              min={1024}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              error={portError}
              hint="Default 7420."
            />
            <Toggle
              label="Allow access from the local network (LAN)"
              description="Other devices on the same Wi-Fi can open the inbox."
              checked={lanEnabled}
              onChange={setLanEnabled}
            />
            {lanEnabled && (
              <Banner tone="warning" title="LAN traffic is plain HTTP">
                Passwords and messages travel unencrypted on your local network. Only enable this on
                a network you trust; use the tunnel for encrypted remote access.
              </Banner>
            )}
          </div>
        </Card>

        <Card title="History">
          <Input
            label="Days of history to import when linking"
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            value={historyDays}
            onChange={(e) => setHistoryDays(e.target.value)}
            error={daysError}
          />
        </Card>

        {patch.error && <Banner tone="error">{errorMessage(patch.error)}</Banner>}
        {saved && !patch.error && !dirty && <Banner tone="success">Settings saved.</Banner>}

        <div className="flex flex-col sm:flex-row">
          <Button type="submit" loading={patch.isPending} disabled={!dirty || !!portError || !!daysError}>
            Save settings
          </Button>
        </div>
      </form>

      <Card title="This device" description="Get a notification for new messages when the inbox isn't open.">
        <PushToggle />
      </Card>
    </div>
  );
}
