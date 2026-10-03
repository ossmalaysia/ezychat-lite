// Preload for the local status window. CommonJS (.cts → .cjs) because sandboxed preloads
// cannot be ES modules. Channel names mirror ipc.ts CHANNELS.
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopUpdatesBridge, DesktopUpdateState } from '@wa-team-inbox/shared';

const updates: DesktopUpdatesBridge = {
  getState: () => ipcRenderer.invoke('wati:updates-state'),
  check: () => ipcRenderer.invoke('wati:updates-check'),
  openDownload: () => ipcRenderer.invoke('wati:updates-download'),
  openRelease: () => ipcRenderer.invoke('wati:updates-release'),
  onChanged: (callback) => {
    const listener = (_event: unknown, state: DesktopUpdateState) => callback(state);
    ipcRenderer.on('wati:updates-changed', listener);
    return () => ipcRenderer.removeListener('wati:updates-changed', listener);
  },
};
contextBridge.exposeInMainWorld('watiUpdates', updates);

contextBridge.exposeInMainWorld('wati', {
  getStatus: () => ipcRenderer.invoke('wati:status'),
  enableService: () => ipcRenderer.invoke('wati:service-enable'),
  disableService: () => ipcRenderer.invoke('wati:service-disable'),
  startService: () => ipcRenderer.invoke('wati:service-start'),
  stopService: () => ipcRenderer.invoke('wati:service-stop'),
  resetAdmin: () => ipcRenderer.invoke('wati:reset-admin'),
  openMain: () => ipcRenderer.invoke('wati:open-main'),
  openLogs: () => ipcRenderer.invoke('wati:open-logs'),
  onStatusChanged: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('wati:status-changed', listener);
    return () => ipcRenderer.removeListener('wati:status-changed', listener);
  },
});
