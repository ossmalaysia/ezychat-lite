import clsx from 'clsx';
import type React from 'react';
import { useId } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  ref?: React.Ref<HTMLInputElement>;
}

/** Text input with label/hint/error. Font size stays >= 16px (text-base) to avoid iOS zoom. */
export function Input({ label, hint, error, id, className, ref, ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-neutral-800 dark:text-neutral-200"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(
          'min-h-11 w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-400',
          'focus:outline-none focus:ring-2 focus:ring-emerald-500/60',
          'dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500',
          error
            ? 'border-red-500 dark:border-red-500'
            : 'border-neutral-300 focus:border-emerald-500 dark:border-neutral-700',
          'disabled:opacity-60',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-sm text-neutral-500 dark:text-neutral-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
