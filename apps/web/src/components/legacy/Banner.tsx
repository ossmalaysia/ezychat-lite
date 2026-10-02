import clsx from 'clsx';
import type React from 'react';

export type BannerTone = 'info' | 'success' | 'warning' | 'error';

const tones: Record<BannerTone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-100',
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100',
  warning:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100',
  error:
    'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100',
};

export interface BannerProps {
  tone?: BannerTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function Banner({ tone = 'info', title, children, action, className }: BannerProps) {
  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      className={clsx(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-sm',
        tones[tone],
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title ? 'mt-0.5' : undefined)}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
