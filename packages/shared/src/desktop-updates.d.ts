/** Serialized desktop-only update bridge. Never accepts a renderer-supplied URL. */
export interface DesktopRelease {
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  prerelease: boolean;
  releaseUrl: string;
  downloadUrl: string | null;
  assetName: string | null;
  /** Trusted GitHub asset metadata; missing values prevent managed installation. */
  assetSize?: number | null;
  assetSha256?: string | null;
}

export interface DesktopUpdateTransfer {
  status: 'idle' | 'downloading' | 'ready' | 'installing' | 'error';
  version: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
}

export interface DesktopUpdateState {
  isHost: boolean;
  status: 'idle' | 'checking' | 'available' | 'current' | 'error';
  currentVersion: string;
  checkedAt: string | null;
  release: DesktopRelease | null;
  error: string | null;
  transfer?: DesktopUpdateTransfer;
  canInstall?: boolean;
  installUnavailableReason?: string | null;
  lastInstall?: { status: 'success' | 'error'; version: string; message: string } | null;
}

export interface DesktopUpdatesBridge {
  getState(): Promise<DesktopUpdateState>;
  check(): Promise<DesktopUpdateState>;
  openDownload(): Promise<void>;
  openRelease(): Promise<void>;
  /** Install only the native host's verified downloaded release; no renderer arguments. */
  installUpdate?(): Promise<void>;
  cancelDownload?(): Promise<void>;
  onChanged(callback: (state: DesktopUpdateState) => void): () => void;
}
