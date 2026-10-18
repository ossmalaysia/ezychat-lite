import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAppLinks } from '@/lib/app-links';
import { ResponsiveDialog } from './index';
import { AppCredits } from './AppCredits';
import { DesktopUpdatePanel } from './DesktopUpdates';

/** "About <product>": icon, name, description, version, repo (or website) link and credits. */
export function AboutDialog({
  open,
  onOpenChange,
  version,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version?: string;
}) {
  const { t } = useTranslation(['app', 'common']);
  const links = useAppLinks();
  // Lite links its public source code; another product links its website instead.
  const projectLink = links.sourceCode
    ? { href: links.sourceCode, label: t('about.github') }
    : { href: links.website, label: t('about.website') };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('about.title')}
      description={t('about.description')}
    >
      <div className="flex flex-col items-center gap-4 pb-4 text-center">
        <img
          src="/icon-192.png"
          alt=""
          aria-hidden="true"
          className="size-16 select-none rounded-2xl"
        />
        <div>
          <p className="text-base font-semibold">{t('common:appName')}</p>
          <p className="text-sm text-muted-foreground">
            {version ? t('about.version', { version }) : t('about.versionUnknown')}
          </p>
        </div>
        <DesktopUpdatePanel />
        <Button asChild variant="outline" size="touch">
          <a href={projectLink.href} target="_blank" rel="noopener noreferrer">
            {projectLink.label}
            <ExternalLink aria-hidden="true" />
          </a>
        </Button>
        <AppCredits />
      </div>
    </ResponsiveDialog>
  );
}

export default AboutDialog;
