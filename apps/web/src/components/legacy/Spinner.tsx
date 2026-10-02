import clsx from 'clsx';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={clsx('inline-flex', className)}>
      <svg
        className="size-full min-h-4 min-w-4 animate-spin text-current"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
        <path
          d="M22 12a10 10 0 0 0-10-10"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** Centered full-screen spinner for route-level loading. */
export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center text-emerald-600 dark:text-emerald-400">
      <Spinner className="size-8" label={label} />
    </div>
  );
}
