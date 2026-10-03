// System tray icon + menu.
import { Menu, Tray, type NativeImage } from 'electron';
import { appTitle } from './app-title.js';

export interface TrayActions {
  open(): void;
  openStatus(): void;
  openTunnelAdmin(): void;
  resetAdmin(): void;
  quit(): void;
  /** label describing the current mode, e.g. "Standalone — running" */
  describe(): string;
}

export function createTray(
  icon: NativeImage,
  actions: TrayActions,
  version: string,
): { tray: Tray; refresh(): void } {
  const title = appTitle(version);
  const tray = new Tray(icon);
  tray.setToolTip(title);
  const refresh = () => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: title, enabled: false },
        { label: actions.describe(), enabled: false },
        { type: 'separator' },
        { label: 'Open', click: () => actions.open() },
        { label: 'Status & Service…', click: () => actions.openStatus() },
        { label: 'Open admin → Tunnel', click: () => actions.openTunnelAdmin() },
        { type: 'separator' },
        { label: 'Reset admin password…', click: () => actions.resetAdmin() },
        { type: 'separator' },
        { label: 'Quit', click: () => actions.quit() },
      ]),
    );
  };
  tray.on('click', () => actions.open());
  refresh();
  return { tray, refresh };
}
