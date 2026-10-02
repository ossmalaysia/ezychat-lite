// Preload for the local status window. CommonJS (.cts → .cjs) because sandboxed preloads
// cannot be ES modules. Channel names mirror ipc.ts CHANNELS.
import { contextBridge, ipcRenderer } from 'electron';

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
