import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppCredits } from '@/components/app';
import { FeatureRequestAction } from '@/components/app/FeatureRequestAction';
import { useAppVersion } from '@/lib/version';

/** Official EzyChat brand mark, shared by desktop and installed PWA. */
export function AppMark({ className = 'size-10' }: { className?: string }) {
  return (
    <img
      src="/icon-192.png"
      alt=""
      aria-hidden="true"
      className={cn('select-none rounded-lg', className)}
    />
  );
}

/** Centered, safe-area aware Card layout for login / setup / password screens. */
export function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
  illustration,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  /** Optional decorative illustration shown above the title. */
  illustration?: string;
}) {
  const version = useAppVersion();
  return (
    <div className="safe-x safe-top safe-bottom min-h-dvh bg-background text-foreground">
      <main className="flex min-h-dvh flex-col items-center px-4 py-8 sm:justify-center">
        <div className={cn('w-full min-w-0', wide ? 'max-w-xl' : 'max-w-sm')}>
          <div className="mb-4 flex items-center justify-center gap-2">
            <AppMark className="size-8 rounded-lg" />
            <span className="text-sm font-semibold tracking-tight">EzyChat Lite</span>
          </div>
          <Card className="gap-5 py-5 sm:py-6">
            <CardHeader className="items-center px-4 text-center sm:px-6">
              {illustration && (
                <img
                  src={illustration}
                  alt=""
                  aria-hidden="true"
                  className="mx-auto mb-1 h-28 w-auto max-w-full select-none object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              <CardTitle>
                <h1 className="text-xl font-semibold leading-tight">{title}</h1>
              </CardTitle>
              {subtitle && <CardDescription>{subtitle}</CardDescription>}
            </CardHeader>
            <CardContent className="px-4 sm:px-6">{children}</CardContent>
          </Card>
          <div className="mt-4 flex justify-center">
            <FeatureRequestAction />
          </div>
          <AppCredits version={version ?? undefined} className="mt-1 px-2" />
        </div>
      </main>
    </div>
  );
}

/** Label + Input + hint/error, wired with ids for accessibility. 16px text, 44px tall. */
export function Field({
  label,
  hint,
  error,
  className,
  id: idProp,
  ...props
}: React.ComponentProps<'input'> & {
  label: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
}) {
  const autoId = React.useId();
  const id = idProp ?? autoId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="h-11 text-base md:text-base"
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Spinner icon used inside busy Buttons. */
export function ButtonSpinner() {
  return <Loader2 className="animate-spin" aria-hidden="true" />;
}

/** Full-viewport loading state while auth/setup status resolves. */
export function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground"
    >
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
    </div>
  );
}
