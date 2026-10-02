import * as React from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

/** Props a Field hands to its control so label, hint and error are wired up for a11y. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

/** Label + control + hint/error text. The control is rendered by `children(props)`. */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: (props: FieldControlProps) => React.ReactNode;
}) {
  const id = React.useId();
  const descId = `${id}-desc`;
  const hasDesc = Boolean(error || hint);
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-describedby': hasDesc ? descId : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {error ? (
        <p id={descId} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={descId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Spinner shown inside a pending button. */
export function Pending({ show }: { show: boolean }) {
  return show ? <Loader2 className="animate-spin" aria-hidden /> : null;
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

/** Copies `text` and confirms with a toast. */
export function CopyButton({
  text,
  label = 'Copy',
  variant = 'outline',
  className,
}: {
  text: string;
  label?: string;
  variant?: 'outline' | 'secondary' | 'default' | 'ghost';
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size="touch"
      className={cn('md:min-h-9', className)}
      onClick={async () => {
        if (await copyText(text)) toast.success('Copied to clipboard');
        else toast.error('Copy failed — select the text and copy it manually.');
      }}
    >
      <Copy aria-hidden />
      {label}
    </Button>
  );
}

/** AlertDialog confirmation for destructive / disruptive actions. Stays open while pending. */
export function ConfirmDialog({
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
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !loading) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {children && <AlertDialogDescription asChild><div>{children}</div></AlertDialogDescription>}
        </AlertDialogHeader>
        {error != null && <Banner tone="danger">{errorMessage(error)}</Banner>}
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11 sm:min-h-9" disabled={loading}>
            Cancel
          </AlertDialogCancel>
          {/* Plain Button (not AlertDialogAction) so the dialog stays open until the mutation settles. */}
          <Button
            variant={danger ? 'destructive' : 'default'}
            className="min-h-11 sm:min-h-9"
            disabled={loading}
            onClick={onConfirm}
          >
            <Pending show={loading} />
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
      tone="danger"
      title="Couldn't load"
      action={
        onRetry && (
          <Button size="touch" variant="outline" className="md:min-h-8" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      {errorMessage(error)}
    </Banner>
  );
}

/** Skeleton placeholder rows for lists/tables while loading. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}
