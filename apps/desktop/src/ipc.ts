// IPC between the status window (preload bridge) and the main process.
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { Locale } from '@wa-team-inbox/shared';
import type { ServerMode } from './detect.js';
import type { ServerState } from './server-process.js';
import type { ServiceState } from './service/index.js';
import { pathToFileURL } from 'node:url';

export type DesktopMode = 'starting' | 'standalone' | 'client' | 'error';

export interface DesktopStatus {
  mode: DesktopMode;
  serverState: ServerState | 'external';
  serviceState: ServiceState;
  serviceSupported: boolean;
  port: number;
  url: string;
  dataDir: string;
  /** desktop app version (app.getVersion()) */
  version: string;
  /** version reported by the server's GET /api/health; null when it is not answering */
  serverVersion: string | null;
  /** server mode from GET /api/health ('standalone' | 'service' | 'dev'); null when not answering */
  serverMode: ServerMode | null;
  platform: NodeJS.Platform;
  busy: string | null;
  logs: string[];
  /** closing the window keeps the app in the system tray */
  keepInTray: boolean;
  /** desktop (OS) language for the status page, its Intl tag and its flattened strings */
  locale: Locale;
  intlTag: string;
  strings: Record<string, string>;
}

export interface DesktopController {
  getStatus(): Promise<DesktopStatus>;
  enableService(): Promise<void>;
  disableService(): Promise<void>;
  startService(): Promise<void>;
  stopService(): Promise<void>;
  resetAdmin(): Promise<void>;
  openMain(): void;
  openLogsFolder(): void;
  setKeepInTray(keep: boolean): Promise<void> | void;
}

export const CHANNELS = {
  status: 'wati:status',
  enableService: 'wati:service-enable',
  disableService: 'wati:service-disable',
  startService: 'wati:service-start',
  stopService: 'wati:service-stop',
  resetAdmin: 'wati:reset-admin',
  openMain: 'wati:open-main',
  openLogs: 'wati:open-logs',
  setKeepInTray: 'wati:set-keep-in-tray',
  changed: 'wati:status-changed',
} as const;

/** A file URL alone is not authority: bind every operation to our current status main frame. */
function trusted(e: IpcMainInvokeEvent, win: BrowserWindow | null, statusUrl: string): boolean {
  return (
    !!win &&
    !win.isDestroyed() &&
    e.sender === win.webContents &&
    e.senderFrame === win.webContents.mainFrame &&
    e.senderFrame?.url === statusUrl
  );
}

export function registerIpc(
  ctrl: DesktopController,
  statusWindow: () => BrowserWindow | null,
  statusFile: string,
): { dispose(): void } {
  const statusUrl = pathToFileURL(statusFile).href;
  const handle = (channel: string, fn: () => Promise<unknown> | unknown) => {
    ipcMain.handle(channel, async (e, ...args: unknown[]) => {
      if (!trusted(e, statusWindow(), statusUrl)) throw new Error('Forbidden status request');
      if (args.length !== 0) throw new Error('Invalid status request');
      return fn();
    });
  };
  handle(CHANNELS.status, () => ctrl.getStatus());
  handle(CHANNELS.enableService, () => ctrl.enableService());
  handle(CHANNELS.disableService, () => ctrl.disableService());
  handle(CHANNELS.startService, () => ctrl.startService());
  handle(CHANNELS.stopService, () => ctrl.stopService());
  handle(CHANNELS.resetAdmin, () => ctrl.resetAdmin());
  handle(CHANNELS.openMain, () => ctrl.openMain());
  handle(CHANNELS.openLogs, () => ctrl.openLogsFolder());
  // The only handler that takes input: exactly one boolean, same trust check as every other control.
  ipcMain.handle(CHANNELS.setKeepInTray, async (e, ...args: unknown[]) => {
    if (!trusted(e, statusWindow(), statusUrl)) throw new Error('Forbidden status request');
    if (args.length !== 1 || typeof args[0] !== 'boolean')
      throw new Error('Invalid status request');
    return ctrl.setKeepInTray(args[0]);
  });
  return {
    dispose() {
      for (const channel of Object.values(CHANNELS)) {
        if (channel !== CHANNELS.changed) ipcMain.removeHandler(channel);
      }
    },
  };
}

/** Never expose host status/logs to unrelated local pages. */
export function broadcastStatusChanged(win: BrowserWindow | null, statusFile: string): void {
  if (win && !win.isDestroyed() && win.webContents.mainFrame.url === pathToFileURL(statusFile).href)
    win.webContents.send(CHANNELS.changed);
}
