import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, RefreshCw, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useDesktopUpdates } from '@/lib/desktop-updates';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Banner, ResponsiveDialog } from './index';

export function DesktopUpdatePanel() {
  const { state, error, check, open, install, cancelDownload } = useDesktopUpdates();
  if (!state?.isHost) return null;
  const checking = state.status === 'checking';
  const release = state.release;
  const transfer = state.transfer;
  const downloading = transfer?.status === 'downloading';
  const installing = transfer?.status === 'installing';
  const ready = transfer?.status === 'ready';
  const managed = state.canInstall !== false && !!window.watiUpdates?.installUpdate;
  const verifiedMetadata = !!release?.assetSha256 && !!release.assetSize;
  const percentage = transfer?.totalBytes
    ? Math.min(100, Math.max(0, Math.round((transfer.downloadedBytes / transfer.totalBytes) * 100)))
    : 0;
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
      {(error || transfer?.error || state.error) && (
        <Banner tone="warning">{error ?? transfer?.error ?? state.error}</Banner>
      )}
      {state.lastInstall && (
        <Banner tone={state.lastInstall.status === 'success' ? 'info' : 'warning'}>
          {state.lastInstall.message}
        </Banner>
      )}
      {(downloading || ready || installing) && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm font-medium">
            {downloading
              ? `Downloading update… ${percentage}%`
              : ready
                ? `Version ${transfer.version} is downloaded and verified.`
                : 'Preparing to restart and update…'}
          </p>
          {downloading && (
            <>
              <div
                role="progressbar"
                aria-label="Update download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percentage}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Your inbox keeps working while this downloads.
              </p>
            </>
          )}
        </div>
      )}
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
            {managed && release.downloadUrl
              ? 'Download the update first. When it is ready, choose Restart and update and approve the system prompt. The app and any installed background service will restart automatically. Your accounts, chats and settings are preserved.'
              : release.downloadUrl
                ? 'Download the installer, quit this app from the tray menu, then install the new version. Your accounts, chats and settings stay on this computer.'
                : 'A compatible installer is not available for this computer yet. See the release on GitHub for details.'}
          </p>
          <p className="text-xs text-muted-foreground">
            Updating briefly interrupts team access. Choose a quiet time.
            {!managed &&
              ' For a Windows service, stop it before installing and start it afterward. On Mac, remove the service before installing and enable it afterward to refresh its protected app copy.'}
          </p>
          {state.installUnavailableReason && (
            <p className="text-sm text-muted-foreground">{state.installUnavailableReason}</p>
          )}
          {managed && !verifiedMetadata && release.downloadUrl && (
            <Banner tone="info">
              This release cannot be verified for installation here. Open the release on GitHub for
              a manual installer.
            </Banner>
          )}
          <div className="flex flex-wrap gap-2">
            {ready && managed ? (
              <Button size="touch" onClick={() => void install()}>
                <RefreshCw aria-hidden /> Restart and update
              </Button>
            ) : (
              release.downloadUrl && (
                <Button
                  size="touch"
                  disabled={downloading || installing || (managed && !verifiedMetadata)}
                  onClick={() => void open('download')}
                >
                  <Download aria-hidden /> Download {release.version}
                </Button>
              )
            )}
            {downloading && (
              <Button variant="outline" size="touch" onClick={() => void cancelDownload()}>
                Cancel download
              </Button>
            )}
            <Button
              variant="outline"
              size="touch"
              disabled={installing}
              onClick={() => void open('release')}
            >
              Release on GitHub <ExternalLink aria-hidden />
            </Button>
          </div>
        </>
      )}
      <Button
        variant="outline"
        size="touch"
        disabled={checking || downloading || ready || installing}
        onClick={() => void check()}
      >
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
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!user || !state?.isHost) {
      setSuggestion(null);
      return;
    }
    if (!state.release || (state.status !== 'available' && state.transfer?.status !== 'ready'))
      return;
    const version = state.release.version;
    const ready = state.transfer?.status === 'ready';
    const key = `${ready ? 'ready' : 'available'}:${version}`;
    if (shown.current === key) return;
    shown.current = key;
    if (ready) {
      setSuggestion(null);
      // The About/update dialog already presents the ready action; avoid stacking another modal.
      if (!document.querySelector('[role="dialog"]')) setOpen(true);
      return;
    }
    setSuggestion(version);
  }, [user, state]);
  if (!user || !state?.isHost) return null;
  return (
    <>
      {suggestion === state.release?.version && !open && (
        <aside
          aria-label="App update available"
          aria-live="polite"
          className="fixed inset-x-3 top-3 z-40 mx-auto max-w-md space-y-2 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                EzyChat Lite {suggestion} is available
              </p>
              <p className="text-sm text-muted-foreground">
                {state.release?.prerelease
                  ? 'A new preview release is ready on GitHub.'
                  : 'A new release is ready on GitHub.'}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss update suggestion"
              onClick={() => setSuggestion(null)}
            >
              <X aria-hidden />
            </Button>
          </div>
          <Button
            size="touch"
            onClick={() => {
              setSuggestion(null);
              setOpen(true);
            }}
          >
            Review update
          </Button>
        </aside>
      )}
      <ResponsiveDialog open={open} onOpenChange={setOpen} title="Update EzyChat Lite">
        <DesktopUpdatePanel />
      </ResponsiveDialog>
    </>
  );
}
