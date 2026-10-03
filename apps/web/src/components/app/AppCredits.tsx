import * as React from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ANCHOR_SPRINT_URL, CUSTOM_FEATURE_URL, GITHUB_ISSUES_URL } from '@/lib/links';

function CreditLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {children}
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

/** Compact, muted attribution + support line. Wraps cleanly on narrow (360px) screens. */
export function AppCredits({ version, className }: { version?: string; className?: string }) {
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
        Need a custom feature? <CreditLink href={CUSTOM_FEATURE_URL}>Contact Anchor Sprint</CreditLink>
      </span>
    </p>
  );
}

export default AppCredits;
