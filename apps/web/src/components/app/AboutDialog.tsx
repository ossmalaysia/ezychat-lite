import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GITHUB_REPO_URL } from '@/lib/links';
import { ResponsiveDialog } from './index';
import { AppCredits } from './AppCredits';
import { DesktopUpdatePanel } from './DesktopUpdates';

/** "About EzyChat Lite": icon, name, description, version, repo link and credits. */
export function AboutDialog({
  open,
  onOpenChange,
  version,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version?: string;
}) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="About EzyChat Lite"
      description="One WhatsApp number, one shared inbox for your whole team — served from your own computer."
    >
      <div className="flex flex-col items-center gap-4 pb-4 text-center">
        <img
          src="/icon-192.png"
          alt=""
          aria-hidden="true"
          className="size-16 select-none rounded-2xl"
        />
        <div>
          <p className="text-base font-semibold">EzyChat Lite</p>
          <p className="text-sm text-muted-foreground">
            {version ? `Version ${version}` : 'Version unknown'}
          </p>
        </div>
        <DesktopUpdatePanel />
        <Button asChild variant="outline" size="touch">
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
            View on GitHub
            <ExternalLink aria-hidden="true" />
          </a>
        </Button>
        <AppCredits />
      </div>
    </ResponsiveDialog>
  );
}

export default AboutDialog;
