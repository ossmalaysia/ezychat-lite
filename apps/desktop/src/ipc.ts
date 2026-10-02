// IPC between the status window (preload bridge) and the main process.
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ServerState } from './server-process.js';
import type { ServiceState } from './service/index.js';

export type DesktopMode = 'starting' | 'standalone' | 'client' | 'error';

export interface DesktopStatus {
  mode: DesktopMode;
  serverState: ServerState | 'external';
  serviceState: ServiceState;
  serviceSupported: boolean;
  port: number;
  url: string;
  dataDir: string;
  version: string;
  platform: NodeJS.Platform;
  busy: string | null;
  logs: string[];
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
  changed: 'wati:status-changed',
} as const;

/** Only our local status page (file://) may call privileged handlers. */
function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith('file://');
}

export function registerIpc(ctrl: DesktopController): void {
  const handle = (channel: string, fn: () => Promise<unknown> | unknown) => {
    ipcMain.handle(channel, async (e) => {
      if (!trusted(e)) throw new Error('forbidden');
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
}

/** Tells every open status window to refresh. */
export function broadcastStatusChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents.getURL().startsWith('file://')) w.webContents.send(CHANNELS.changed);
  }
}
