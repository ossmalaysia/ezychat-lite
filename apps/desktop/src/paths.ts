// Path helpers for the desktop shell. Pure: must not import 'electron' (unit tested under Node).
import { join } from 'node:path';

export const DEFAULT_PORT = 7420;
export const APP_DIR_NAME = 'wa-team-inbox';

/** Keep installed profiles (accounts, sessions and chats) across the product rename. */
export function preserveInstalledProfile(
  app: {
    isPackaged: boolean;
    getPath(name: 'appData'): string;
    setPath(name: 'userData' | 'sessionData', path: string): void;
  },
  ensureDirectory: (path: string) => void,
): void {
  if (!app.isPackaged) return;
  const profile = join(app.getPath('appData'), 'WA Team Inbox');
  ensureDirectory(profile);
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
}

/** Per-user data dir used in standalone mode: <userData>/data. */
export function userDataDir(app: { getPath(name: 'userData'): string }): string {
  return join(app.getPath('userData'), 'data');
}

/** Machine-wide data dir used in service mode. */
export function machineDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32') return `${env.ProgramData ?? 'C:\\ProgramData'}\\${APP_DIR_NAME}`;
  if (platform === 'darwin') return `/Library/Application Support/${APP_DIR_NAME}`;
  return `/var/lib/${APP_DIR_NAME}`;
}

/**
 * Bundled server entry (produced by scripts/bundle-server.mjs). When packaged, appPath is
 * <resources>/app.asar and the file is read through Electron's asar support (also available
 * with ELECTRON_RUN_AS_NODE=1, which the OS service uses).
 */
export function serverEntry(_isPackaged: boolean, _resourcesPath: string, appPath: string): string {
  return join(appPath, 'dist', 'server', 'server.cjs');
}

/** Built web PWA (apps/web/dist); copied to <resources>/web by electron-builder. */
export function webDistDir(isPackaged: boolean, resourcesPath: string, appPath: string): string {
  return isPackaged ? join(resourcesPath, 'web') : join(appPath, '..', 'web', 'dist');
}

/** Directory holding the cloudflared binary for this platform. */
export function cloudflaredDir(
  isPackaged: boolean,
  resourcesPath: string,
  appPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return isPackaged
    ? join(resourcesPath, 'cloudflared')
    : join(appPath, '..', '..', 'resources', 'cloudflared', `${platform}-${arch}`);
}

export function cloudflaredBinary(
  dir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(dir, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

/** WinSW wrapper executable (Windows service mode). */
export function winswExe(isPackaged: boolean, resourcesPath: string, appPath: string): string {
  return isPackaged
    ? join(resourcesPath, 'winsw', 'WinSW-x64.exe')
    : join(appPath, '..', '..', 'resources', 'winsw', 'WinSW-x64.exe');
}

export interface DesktopConfig {
  port: number;
  /** Closing the window keeps the app in the system tray (default) instead of quitting a service client. */
  keepInTray: boolean;
}

/** Parses userData/desktop.json contents (null when missing). Each invalid field falls back to its default. */
export function parseDesktopConfig(raw: string | null): DesktopConfig {
  const def: DesktopConfig = { port: DEFAULT_PORT, keepInTray: true };
  if (!raw) return def;
  try {
    const v = JSON.parse(raw) as { port?: unknown; keepInTray?: unknown };
    const port = v?.port;
    return {
      port:
        typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536
          ? port
          : def.port,
      keepInTray: typeof v?.keepInTray === 'boolean' ? v.keepInTray : def.keepInTray,
    };
  } catch {
    return def;
  }
}

/**
 * New desktop.json contents with `patch` applied. Unknown fields of a valid file are kept; a missing,
 * malformed or non-object file is replaced by normalized defaults, so a change is never silently lost.
 */
export function mergeDesktopConfig(raw: string | null, patch: Partial<DesktopConfig>): string {
  let current: Record<string, unknown> | null = null;
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object' && !Array.isArray(v)) current = v as Record<string, unknown>;
  } catch {
    current = null;
  }
  return JSON.stringify({ ...(current ?? parseDesktopConfig(null)), ...patch }, null, 2);
}

/** Server launcher (compiled from src/server-host.cts) that wraps the bundled server entry. */
export function serverHost(appPath: string): string {
  return join(appPath, 'dist', 'server-host.cjs');
}

/** Port file the standalone server's host writes (user data). */
export function standalonePortFile(userDataPath: string): string {
  return join(userDataPath, 'server-port.json');
}

/**
 * Port file the OS service's host writes, in a folder the signed-in user can read (but not
 * write), so the desktop can find a service whose port was changed in Admin > Settings.
 */
export function servicePortFile(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32') return `${serviceRunDir(platform, env)}\\port.json`;
  return `${serviceRunDir(platform, env)}/port.json`;
}

/** Machine-wide folder readable by local users (port file). Admin/root-owned, not user-writable. */
export function serviceRunDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // inside the locked-down data dir; the install script grants Users read on this sub-folder only
  if (platform === 'win32') return `${machineDataDir(platform, env)}\\run`;
  if (platform === 'darwin') return `/Library/Application Support/${APP_DIR_NAME}-runtime`;
  return `/var/lib/${APP_DIR_NAME}-run`;
}

/**
 * Tray icon file: build/tray/trayTemplate.png on macOS (template image, black + alpha) and
 * build/tray/tray.png elsewhere. Copied to <resources>/tray by electron-builder (extraResources).
 */
export function trayIconFile(
  isPackaged: boolean,
  resourcesPath: string,
  appPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const name = platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  return isPackaged ? join(resourcesPath, 'tray', name) : join(appPath, 'build', 'tray', name);
}
