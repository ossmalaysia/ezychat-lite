import { ExternalLink, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAppLinks } from '@/lib/app-links';
import { cn } from '@/lib/utils';

/**
 * The "Upgrade to Enterprise" address, or null when the product hides it: Lite links
 * ezychat.ai/#enterprise (with a campaign tag), another product passes `createInboxApp({ links: { upgrade: null } })`.
 */
export function useUpgradeUrl(): string | null {
  return useAppLinks().upgrade;
}

/** An outline button that opens the Enterprise page in the browser; nothing when hidden. */
export function UpgradeButton({ className }: { className?: string }) {
  const { t } = useTranslation('common');
  const url = useUpgradeUrl();
  if (!url) return null;
  return (
    <Button asChild variant="outline" size="touch" className={className}>
      <a href={url} target="_blank" rel="noopener noreferrer" data-testid="upgrade-enterprise">
        <Sparkles aria-hidden="true" />
        {t('upgrade.cta')}
        <ExternalLink aria-hidden="true" />
      </a>
    </Button>
  );
}

/** A quiet row under a Lite limit: why Enterprise helps, and the upgrade button. */
export function UpgradeNote({
  reason,
  className,
}: {
  reason: 'agents' | 'numbers';
  className?: string;
}) {
  const { t } = useTranslation('common');
  const url = useUpgradeUrl();
  if (!url) return null;
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
      data-testid="upgrade-note"
    >
      <p className="min-w-0 text-sm text-muted-foreground">
        {reason === 'agents' ? t('upgrade.agents') : t('upgrade.numbers')}
      </p>
      <UpgradeButton className="shrink-0 self-start sm:self-auto" />
    </div>
  );
}
