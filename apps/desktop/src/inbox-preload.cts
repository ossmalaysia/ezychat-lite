// Keep the remote inbox bridge separate from the privileged local status window.
// Sandboxed preloads must be CommonJS and cannot import local modules.
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

contextBridge.exposeInMainWorld('watiNotifications', {
  isSupported: (): Promise<boolean> => ipcRenderer.invoke('wati:notifications-supported'),
  show: (payload: { title: string; body: string; url: string; tag: string }): Promise<boolean> =>
    ipcRenderer.invoke('wati:notifications-show', payload),
  clear: (): Promise<void> => ipcRenderer.invoke('wati:notifications-clear'),
});
