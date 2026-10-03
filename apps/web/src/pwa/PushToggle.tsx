import { useEffect, useId, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { InstallHint } from './InstallHint';
import { desktopNotificationsEnabled, isDesktopNotifications } from './desktop-notifications';
import {
  getCurrentSubscription,
  isPushSupported,
  needsInstallForPush,
  subscribePush,
  unsubscribePush,
} from './push';

type Status = 'checking' | 'unsupported' | 'install' | 'denied' | 'off' | 'on';

function initialStatus(): Status {
  if (isDesktopNotifications()) return desktopNotificationsEnabled() ? 'on' : 'off';
  if (needsInstallForPush()) return 'install';
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'checking';
}

/**
 * Push-notification opt-in for the current device (place it in the user menu).
 * `compact` renders a single row suitable for menus / side bars.
 */
export function PushToggle({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const id = useId();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'checking') return;
    let alive = true;
    getCurrentSubscription()
      .then(
        (sub) => alive && setStatus(sub && Notification.permission === 'granted' ? 'on' : 'off'),
      )
      .catch(() => alive && setStatus('off'));
    return () => {
      alive = false;
    };
  }, [status]);

  if (status === 'install') return <InstallHint className={className} force />;

  if (status === 'unsupported') {
    return compact ? null : (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Notifications aren't supported in this browser.
      </p>
    );
  }

  const toggle = async () => {
    setError(null);
    setBusy(true);
    try {
      if (status === 'on') {
        await unsubscribePush();
        setStatus('off');
      } else {
        await subscribePush();
        setStatus('on');
      }
    } catch (e) {
      if (!isDesktopNotifications() && isPushSupported() && Notification.permission === 'denied')
        setStatus('denied');
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const on = status === 'on';
  const disabled = busy || status === 'checking' || status === 'denied';
  const Icon = on ? Bell : BellOff;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-3 rounded-md',
          !compact && 'px-1',
        )}
      >
        <Label
          htmlFor={id}
          className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 text-sm font-medium"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{compact ? 'Notifications' : 'Notifications on this device'}</span>
        </Label>
        <Switch
          id={id}
          className="shrink-0"
          aria-label={compact ? 'Notifications on this device' : undefined}
          checked={on}
          disabled={disabled}
          aria-busy={busy || undefined}
          onCheckedChange={() => void toggle()}
          onClick={(e) => e.stopPropagation()}
          // Inside a DropdownMenu, keep Space/Enter from being treated as menu typeahead/select.
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
          }}
        />
      </div>
      {isDesktopNotifications() && !compact && (
        <p className="text-xs text-muted-foreground">
          Alerts appear when this app is in the background. Keep it running in the tray and allow WA
          Team Inbox in your system notification settings.
        </p>
      )}
      {status === 'denied' && (
        <Banner tone="warning" className="text-xs">
          Notifications are blocked. Allow them in the browser's site settings.
        </Banner>
      )}
      {error && status !== 'denied' && (
        <Banner tone="danger" className="text-xs">
          {error}
        </Banner>
      )}
    </div>
  );
}

export default PushToggle;
