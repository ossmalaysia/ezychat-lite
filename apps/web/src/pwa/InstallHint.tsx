import clsx from 'clsx';
import { needsInstallForPush } from './push';

/**
 * iOS Safari only delivers notifications to Home Screen web apps.
 * Renders nothing elsewhere (or when `force` is false and already installed).
 */
export function InstallHint({ className, force = false }: { className?: string; force?: boolean }) {
  if (!force && !needsInstallForPush()) return null;
  return (
    <div
      role="note"
      className={clsx(
        'rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-100',
        className,
      )}
    >
      <p className="font-semibold">Add to Home Screen to receive notifications</p>
      <p className="mt-0.5">
        Tap the Share button{' '}
        <svg viewBox="0 0 24 24" className="inline size-4 align-text-bottom" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Share">
          <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>{' '}
        in Safari, choose <strong>Add to Home Screen</strong>, then open Team Inbox from your home
        screen and turn on notifications.
      </p>
    </div>
  );
}

export default InstallHint;
