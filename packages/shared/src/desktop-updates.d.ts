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
}

export interface DesktopUpdateState {
  isHost: boolean;
  status: 'idle' | 'checking' | 'available' | 'current' | 'error';
  currentVersion: string;
  checkedAt: string | null;
  release: DesktopRelease | null;
  error: string | null;
}

export interface DesktopUpdatesBridge {
  getState(): Promise<DesktopUpdateState>;
  check(): Promise<DesktopUpdateState>;
  openDownload(): Promise<void>;
  openRelease(): Promise<void>;
  onChanged(callback: (state: DesktopUpdateState) => void): () => void;
}
