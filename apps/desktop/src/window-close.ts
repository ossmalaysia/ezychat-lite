import type { DesktopMode } from './ipc.js';

/**
 * What closing the inbox window does. Only a client of the background service may quit: in every
 * other mode this app hosts (or is starting) the server the team depends on, so it stays in the tray.
 */
export function closeAction(mode: DesktopMode, keepInTray: boolean): 'hide' | 'quit' {
  return mode === 'client' && !keepInTray ? 'quit' : 'hide';
}
