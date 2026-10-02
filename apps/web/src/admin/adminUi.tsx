import clsx from 'clsx';
import type React from 'react';
import { useEffect, useId, useState } from 'react';
import { errorMessage } from '../api/client';
import { Banner, Button, Modal, type ButtonVariant } from '../components/legacy';

/** Page title + optional actions; wraps on narrow screens. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: React.ReactNode;
  hint?: React.ReactNode;
}

/** Labeled native select (16px font, 44px touch target). */
export function Select({ label, hint, id, className, children, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={selectId}
        className="text-sm font-medium text-neutral-800 dark:text-neutral-200"
      >
        {label}
      </label>
      <select
        id={selectId}
        className={clsx(
          'min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900',
          'focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60',
          'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      {hint && <p className="text-sm text-neutral-500 dark:text-neutral-400">{hint}</p>}
    </div>
  );
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
}

export function Textarea({ label, hint, error, id, className, ...rest }: TextareaProps) {
  const autoId = useId();
  const tid = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={tid} className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
        {label}
      </label>
      <textarea
        id={tid}
        aria-invalid={error ? true : undefined}
        className={clsx(
          'min-h-24 w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-900',
          'focus:outline-none focus:ring-2 focus:ring-emerald-500/60',
          'dark:bg-neutral-900 dark:text-neutral-100',
          error ? 'border-red-500' : 'border-neutral-300 dark:border-neutral-700',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{hint}</p>
      ) : null}
    </div>
  );
}

/** Accessible on/off switch with a 44px touch target. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
          {label}
        </label>
        {description && (
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="inline-flex min-h-11 shrink-0 items-center disabled:opacity-50"
      >
        <span
          className={clsx(
            'relative inline-block h-6 w-11 rounded-full transition-colors',
            checked ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700',
          )}
        >
          <span
            className={clsx(
              'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
              checked ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </span>
      </button>
    </div>
  );
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  text,
  label = 'Copy',
  variant = 'secondary',
}: {
  text: string;
  label?: string;
  variant?: ButtonVariant;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <Button
      variant={variant}
      size="sm"
      onClick={async () => setState((await copyText(text)) ? 'copied' : 'failed')}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </Button>
  );
}

/** Confirmation dialog for destructive / disruptive actions. */
export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  danger = false,
  loading = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  error?: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      dismissable={!loading}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
        {children}
        {error != null && <Banner tone="error">{errorMessage(error)}</Banner>}
      </div>
    </Modal>
  );
}

/** Generates a readable random password (no ambiguous characters). */
export function generatePassword(length = 14): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const out: string[] = [];
  const buf = new Uint32Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < length; i++) buf[i] = Math.floor(Math.random() * 2 ** 32);
  for (let i = 0; i < length; i++) out.push(chars[(buf[i] ?? 0) % chars.length] ?? 'x');
  return out.join('');
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Banner
      tone="error"
      title="Couldn't load"
      action={
        onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      {errorMessage(error)}
    </Banner>
  );
}
