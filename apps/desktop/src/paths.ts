// Path helpers for the desktop shell. Pure: must not import 'electron' (unit tested under Node).
import { join } from 'node:path';

export const DEFAULT_PORT = 7420;
export const APP_DIR_NAME = 'wa-team-inbox';

/** Per-user data dir used in standalone mode: <userData>/data. */
export function userDataDir(app: { getPath(name: 'userData'): string }): string {
  return join(app.getPath('userData'), 'data');
}

/** Machine-wide data dir used in service mode. */
export function machineDataDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
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

export function cloudflaredBinary(dir: string, platform: NodeJS.Platform = process.platform): string {
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
}

/** Parses userData/desktop.json contents (null when missing). Invalid input → defaults. */
export function parseDesktopConfig(raw: string | null): DesktopConfig {
  const def: DesktopConfig = { port: DEFAULT_PORT };
  if (!raw) return def;
  try {
    const v = JSON.parse(raw) as { port?: unknown };
    const port = v?.port;
    if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536) return { port };
    return def;
  } catch {
    return def;
  }
}
