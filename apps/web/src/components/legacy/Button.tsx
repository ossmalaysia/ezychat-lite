import clsx from 'clsx';
import type React from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 focus-visible:ring-emerald-500 dark:bg-emerald-500 dark:text-neutral-950 dark:hover:bg-emerald-400',
  secondary:
    'border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50 active:bg-neutral-100 focus-visible:ring-emerald-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800',
  ghost:
    'bg-transparent text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 focus-visible:ring-emerald-500 dark:text-neutral-200 dark:hover:bg-neutral-800',
  danger:
    'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 focus-visible:ring-red-500 dark:bg-red-500 dark:hover:bg-red-400',
};

// All sizes keep a >= 44px touch target (sm shrinks only on >= sm screens).
const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-sm sm:min-h-9',
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-12 px-5 text-base',
  icon: 'size-11 p-0',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}
