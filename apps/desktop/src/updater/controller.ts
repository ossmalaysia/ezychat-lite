import type {
  DesktopRelease,
  DesktopUpdateState,
  DesktopUpdateTransfer,
} from '@wa-team-inbox/shared';
import type { DownloadedRelease } from './download.js';

interface ReleaseChecker {
  getState(): DesktopUpdateState;
  check(): Promise<DesktopUpdateState>;
  start(): void;
  stop(): void;
}

export interface ManagedUpdateOptions {
  checker: ReleaseChecker;
  canInstall(): boolean;
  unavailableReason: string;
  download(
    release: DesktopRelease,
    signal: AbortSignal,
    progress: (value: { receivedBytes: number; totalBytes: number }) => void,
  ): Promise<DownloadedRelease>;
  verify(artifact: DownloadedRelease, release: DesktopRelease): Promise<void>;
  install(artifact: DownloadedRelease): Promise<void>;
  onChanged(): void;
  lastInstall?: DesktopUpdateState['lastInstall'];
  log?(fields: Record<string, unknown>): void;
}

const idle = (): DesktopUpdateTransfer => ({
  status: 'idle',
  version: null,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
});

/** Renderer actions select no paths or URLs; the checked release stays pinned through installation. */
export class ManagedUpdates {
  private transfer = idle();
  private release: DesktopRelease | null = null;
  private artifact: DownloadedRelease | null = null;
  private abort: AbortController | null = null;
  private pendingDownload: Promise<void> | null = null;
  private pendingInstall: Promise<void> | null = null;
  private generation = 0;

  constructor(private readonly options: ManagedUpdateOptions) {}

  getState(): DesktopUpdateState {
    const base = this.options.checker.getState();
    return {
      ...base,
      release: base.isHost && this.release ? { ...this.release } : base.release,
      transfer: base.isHost ? { ...this.transfer } : idle(),
      canInstall: base.isHost && this.options.canInstall(),
      installUnavailableReason:
        base.isHost && !this.options.canInstall() ? this.options.unavailableReason : null,
      lastInstall: base.isHost ? (this.options.lastInstall ?? null) : null,
    };
  }

  start(): void {
    this.options.checker.start();
  }
  stop(): void {
    this.cancelDownload();
    this.options.checker.stop();
  }
  async check(): Promise<DesktopUpdateState> {
    if (!this.pendingDownload && !this.pendingInstall && !this.artifact)
      await this.options.checker.check();
    return this.getState();
  }

  private requireHost(): void {
    if (!this.options.checker.getState().isHost)
      throw new Error('Only the hosting computer can update this inbox.');
    if (!this.options.canInstall()) throw new Error(this.options.unavailableReason);
  }
  private publish(transfer: DesktopUpdateTransfer): void {
    this.transfer = transfer;
    this.options.onChanged();
  }

  download(): Promise<void> {
    this.requireHost();
    if (this.pendingDownload) {
      // Finish cancelling the previous file/network job before retrying its cache key.
      return this.abort ? this.pendingDownload : this.pendingDownload.then(() => this.download());
    }
    if (this.pendingInstall) return Promise.resolve();
    const release = this.release ?? this.options.checker.getState().release;
    if (!release?.downloadUrl) throw new Error('No compatible update is available.');
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.release = { ...release };
    this.artifact = null;
    this.publish({
      status: 'downloading',
      version: release.version,
      downloadedBytes: 0,
      totalBytes: release.assetSize ?? null,
      error: null,
    });
    const pending = Promise.resolve().then(async () => {
      try {
        const artifact = await this.options.download(release, abort.signal, (progress) => {
          if (generation === this.generation && this.options.checker.getState().isHost) {
            this.publish({
              ...this.transfer,
              downloadedBytes: progress.receivedBytes,
              totalBytes: progress.totalBytes,
            });
          }
        });
        if (generation !== this.generation || abort.signal.aborted) return;
        this.requireHost();
        this.artifact = artifact;
        this.publish({
          status: 'ready',
          version: artifact.version,
          downloadedBytes: artifact.size,
          totalBytes: artifact.size,
          error: null,
        });
        this.options.log?.({
          mod: 'desktop-updates',
          event: 'download_ready',
          version: artifact.version,
        });
      } catch (error) {
        if (generation !== this.generation || abort.signal.aborted) return;
        this.fail(error, 'download_failed');
      } finally {
        if (this.pendingDownload === pending) this.pendingDownload = null;
        if (this.abort === abort) this.abort = null;
      }
    });
    this.pendingDownload = pending;
    return pending;
  }

  cancelDownload(): void {
    if (!this.abort) return;
    this.generation++;
    this.abort.abort();
    this.abort = null;
    this.release = null;
    this.artifact = null;
    this.publish(idle());
  }

  install(): Promise<void> {
    this.requireHost();
    if (this.pendingInstall) return this.pendingInstall;
    const artifact = this.artifact;
    const release = this.release;
    if (!artifact || !release || this.transfer.status !== 'ready') {
      throw new Error('Download and verify the update before installing.');
    }
    this.publish({ ...this.transfer, status: 'installing', error: null });
    const pending = Promise.resolve().then(async () => {
      try {
        await this.options.verify(artifact, release);
        this.requireHost();
        await this.options.install(artifact);
      } catch (error) {
        this.fail(error, 'install_failed');
      } finally {
        if (this.pendingInstall === pending) this.pendingInstall = null;
      }
    });
    this.pendingInstall = pending;
    return pending;
  }

  private fail(error: unknown, event: string): void {
    this.artifact = null;
    this.release = null;
    this.publish({
      ...this.transfer,
      status: 'error',
      error: error instanceof Error ? error.message : 'The update could not finish. Try again.',
    });
    this.options.log?.({ mod: 'desktop-updates', event, version: this.transfer.version });
  }
}
