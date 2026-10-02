import type React from 'react';

/** Brand mark: simple chat bubble in emerald (deliberately not any third-party logo). */
export function AppMark({ className = 'size-10' }: { className?: string }) {
  return <img src="/icon.svg" alt="" aria-hidden="true" className={className} />;
}

/** Centered, safe-area aware layout for login / setup / password screens. */
export function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="safe-x safe-top safe-bottom min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <div className="flex min-h-dvh flex-col items-center px-4 py-8 sm:justify-center">
        <div className={wide ? 'w-full max-w-xl' : 'w-full max-w-sm'}>
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <AppMark className="size-12" />
            <div>
              <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-6 dark:border-neutral-800 dark:bg-neutral-900">
            {children}
          </div>
          <p className="mt-6 text-center text-xs text-neutral-500 dark:text-neutral-500">
            WA Team Inbox
          </p>
        </div>
      </div>
    </div>
  );
}
