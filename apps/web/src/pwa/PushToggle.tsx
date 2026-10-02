import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { InstallHint } from './InstallHint';
import {
  getCurrentSubscription,
  isPushSupported,
  needsInstallForPush,
  subscribePush,
  unsubscribePush,
} from './push';

type Status = 'checking' | 'unsupported' | 'install' | 'denied' | 'off' | 'on';

function initialStatus(): Status {
  if (needsInstallForPush()) return 'install';
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'checking';
}

/**
 * Push-notification opt-in for the current device (place it in the user menu).
 * `compact` renders a single row suitable for menus / side bars.
 */
export function PushToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'checking') return;
    let alive = true;
    getCurrentSubscription()
      .then((sub) => alive && setStatus(sub && Notification.permission === 'granted' ? 'on' : 'off'))
      .catch(() => alive && setStatus('off'));
    return () => {
      alive = false;
    };
  }, [status]);

  if (status === 'install') return <InstallHint className={className} force />;

  if (status === 'unsupported') {
    return compact ? null : (
      <p className={clsx('text-sm text-neutral-500', className)}>
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
      if (isPushSupported() && Notification.permission === 'denied') setStatus('denied');
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const on = status === 'on';
  const disabled = busy || status === 'checking' || status === 'denied';

  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => void toggle()}
        className={clsx(
          'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm font-medium',
          'hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-neutral-800',
        )}
      >
        <span>Notifications on this device</span>
        <span
          aria-hidden="true"
          className={clsx(
            'relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors',
            on ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700',
          )}
        >
          <span
            className={clsx(
              'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
              on ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </span>
      </button>
      {status === 'denied' && (
        <p className="px-3 text-xs text-amber-700 dark:text-amber-400">
          Notifications are blocked. Allow them in the browser's site settings.
        </p>
      )}
      {error && status !== 'denied' && (
        <p role="alert" className="px-3 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export default PushToggle;
