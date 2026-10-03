// Keep the remote inbox bridge separate from the privileged local status window.
// Sandboxed preloads must be CommonJS and cannot import local modules.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('watiNotifications', {
  isSupported: (): Promise<boolean> => ipcRenderer.invoke('wati:notifications-supported'),
  show: (payload: { title: string; body: string; url: string; tag: string }): Promise<boolean> =>
    ipcRenderer.invoke('wati:notifications-show', payload),
  clear: (): Promise<void> => ipcRenderer.invoke('wati:notifications-clear'),
});
