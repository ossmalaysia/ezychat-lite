// System tray icon + menu.
import { Menu, Tray, type NativeImage } from 'electron';

export interface TrayActions {
  open(): void;
  openStatus(): void;
  openTunnelAdmin(): void;
  resetAdmin(): void;
  quit(): void;
  /** label describing the current mode, e.g. "Standalone — running" */
  describe(): string;
}

export function createTray(icon: NativeImage, actions: TrayActions): { tray: Tray; refresh(): void } {
  const tray = new Tray(icon);
  tray.setToolTip('WA Team Inbox');
  const refresh = () => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'WA Team Inbox', enabled: false },
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
