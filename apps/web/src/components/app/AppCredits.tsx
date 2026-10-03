import * as React from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ANCHOR_SPRINT_URL, CUSTOM_FEATURE_URL, GITHUB_ISSUES_URL } from '@/lib/links';

function CreditLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
    >
      {children}
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

/** Muted attribution and support, with a stacked layout for narrow admin sidebars. */
export function AppCredits({
  version,
  className,
  variant = 'inline',
}: {
  version?: string;
  className?: string;
  variant?: 'inline' | 'sidebar';
}) {
  if (variant === 'sidebar') {
    return (
      <div className={cn('min-w-0 text-xs text-muted-foreground', className)}>
        <div className="flex flex-wrap items-center justify-between gap-x-2 px-2">
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            Built by
            <CreditLink href={ANCHOR_SPRINT_URL} className="min-h-11">
              Anchor Sprint
            </CreditLink>
          </span>
          {version && <span className="whitespace-nowrap">v{version}</span>}
        </div>
        <nav aria-label="Support links" className="flex flex-col">
          {[
            { href: GITHUB_ISSUES_URL, label: 'Report an issue' },
            { href: CUSTOM_FEATURE_URL, label: 'Custom features' },
          ].map(({ href, label }) => (
            <Button
              key={label}
              asChild
              variant="ghost"
              size="touch"
              className="justify-between px-2 text-sm font-normal text-muted-foreground"
            >
              <a href={href} target="_blank" rel="noopener noreferrer">
                {label}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </Button>
          ))}
        </nav>
      </div>
    );
  }

  return (
    <p
      className={cn(
        'flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs text-muted-foreground',
        className,
      )}
    >
      {version && <span>v{version}</span>}
      <span className="inline-flex items-center gap-1">
        Built by <CreditLink href={ANCHOR_SPRINT_URL}>Anchor Sprint</CreditLink>
      </span>
      <CreditLink href={GITHUB_ISSUES_URL}>Report an issue</CreditLink>
      <span className="inline-flex flex-wrap items-center justify-center gap-1">
        Need a custom feature?{' '}
        <CreditLink href={CUSTOM_FEATURE_URL}>Contact Anchor Sprint</CreditLink>
      </span>
    </p>
  );
}

export default AppCredits;
