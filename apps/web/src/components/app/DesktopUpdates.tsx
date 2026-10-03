import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { useDesktopUpdates } from '@/lib/desktop-updates';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Banner, ResponsiveDialog } from './index';

export function DesktopUpdatePanel() {
  const { state, error, check, open } = useDesktopUpdates();
  if (!state?.isHost) return null;
  const checking = state.status === 'checking';
  const release = state.release;
  return (
    <section aria-label="App updates" className="w-full space-y-3 rounded-lg border p-3 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">App updates</h2>
        <span className="text-xs text-muted-foreground">Installed {state.currentVersion}</span>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {checking
          ? 'Checking GitHub…'
          : state.status === 'current'
            ? 'No newer published release is available.'
            : release
              ? `Version ${release.version} is available.`
              : state.status === 'error'
                ? 'Update check could not finish.'
                : 'This computer checks GitHub for new releases automatically.'}
      </p>
      {(error || state.error) && <Banner tone="warning">{error ?? state.error}</Banner>}
      {release && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{release.name}</p>
            {release.prerelease && <Badge variant="secondary">Preview release</Badge>}
          </div>
          {release.notes && (
            <div className="max-h-44 overflow-y-auto rounded-md bg-muted/50 p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
              {release.notes}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {release.downloadUrl
              ? 'Download the installer, quit this app from the tray menu, then install the new version. Your accounts, chats and settings stay on this computer.'
              : 'A compatible installer is not available for this computer yet. See the release on GitHub for details.'}
          </p>
          <p className="text-xs text-muted-foreground">
            Updating the host briefly interrupts team access. Choose a quiet time. If you run the
            background service on Windows, stop it in Status &amp; Service before installing and
            start it again afterward. On Mac, remove the service before installing, then enable it
            again afterward to update its protected app copy. Service removal keeps your data.
          </p>
          <div className="flex flex-wrap gap-2">
            {release.downloadUrl && (
              <Button size="touch" onClick={() => void open('download')}>
                <Download aria-hidden /> Download {release.version}
              </Button>
            )}
            <Button variant="outline" size="touch" onClick={() => void open('release')}>
              Release on GitHub <ExternalLink aria-hidden />
            </Button>
          </div>
        </>
      )}
      <Button variant="outline" size="touch" disabled={checking} onClick={() => void check()}>
        <RefreshCw aria-hidden className={checking ? 'animate-spin' : undefined} />
        {checking ? 'Checking…' : 'Check for updates'}
      </Button>
      {state.checkedAt && (
        <p className="text-xs text-muted-foreground">
          Last checked {new Date(state.checkedAt).toLocaleString()}
        </p>
      )}
    </section>
  );
}

/** A suggestion, never an automatic installation or interruption of a conversation. */
export function DesktopUpdateNotice() {
  const { user } = useAuth();
  const { state } = useDesktopUpdates();
  const shown = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!user || !state?.isHost) {
      toast.dismiss('desktop-update-available');
      return;
    }
    if (state.status !== 'available' || !state.release) return;
    const version = state.release.version;
    if (shown.current === version) return;
    shown.current = version;
    toast(`EzyChat Lite ${version} is available`, {
      id: 'desktop-update-available',
      description: state.release.prerelease
        ? 'A new preview release is ready on GitHub.'
        : 'A new release is ready on GitHub.',
      duration: Infinity,
      action: { label: 'Review update', onClick: () => setOpen(true) },
    });
  }, [user, state]);
  useEffect(() => {
    return () => {
      toast.dismiss('desktop-update-available');
    };
  }, []);
  if (!user || !state?.isHost) return null;
  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen} title="Update EzyChat Lite">
      <DesktopUpdatePanel />
    </ResponsiveDialog>
  );
}
