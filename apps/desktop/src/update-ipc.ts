import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { pathToFileURL } from 'node:url';
import type { DesktopUpdateState } from '@wa-team-inbox/shared';
import type { DesktopMode } from './ipc.js';
import type { ServiceState } from './service/index.js';

export const UPDATE_CHANNELS = {
  state: 'wati:updates-state',
  check: 'wati:updates-check',
  download: 'wati:updates-download',
  install: 'wati:updates-install',
  cancel: 'wati:updates-cancel',
  release: 'wati:updates-release',
  changed: 'wati:updates-changed',
} as const;

/** A client connected to an independently started server does not own its updates. */
export function isUpdateHost(mode: DesktopMode, serviceState: ServiceState): boolean {
  return mode === 'standalone' || serviceState !== 'not-installed';
}

interface UpdateController {
  getState(): DesktopUpdateState;
  check(): Promise<DesktopUpdateState>;
  download(): Promise<void>;
  install(): Promise<void>;
  cancelDownload(): void;
}

interface UpdateWindows {
  main(): BrowserWindow | null;
  status(): BrowserWindow | null;
  baseUrl(): string;
  statusFile: string;
}

function sameInboxOrigin(value: string, base: string): boolean {
  try {
    const target = new URL(value);
    const origin = new URL(base);
    return (
      origin.protocol === 'http:' &&
      origin.hostname === '127.0.0.1' &&
      target.origin === origin.origin &&
      !target.username &&
      !target.password
    );
  } catch {
    return false;
  }
}

/** Register once; window getters ensure destroyed/recreated windows cannot retain authority. */
export function registerUpdateIpc(
  controller: UpdateController,
  windows: UpdateWindows,
): {
  broadcast(state: DesktopUpdateState): void;
  dispose(): void;
} {
  const statusUrl = pathToFileURL(windows.statusFile).href;
  const trustedWindow = (win: BrowserWindow | null, frameUrl: string): boolean =>
    !!win &&
    !win.isDestroyed() &&
    (win === windows.main()
      ? sameInboxOrigin(frameUrl, windows.baseUrl())
      : frameUrl === statusUrl);
  const trusted = (event: IpcMainInvokeEvent): boolean => {
    for (const win of [windows.main(), windows.status()]) {
      if (
        trustedWindow(win, event.senderFrame?.url ?? '') &&
        event.sender === win!.webContents &&
        event.senderFrame === win!.webContents.mainFrame
      )
        return true;
    }
    return false;
  };
  const handle = (channel: string, action: () => unknown) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!trusted(event)) throw new Error('Forbidden update request');
      // No renderer data, including URLs, may enter the privileged action.
      if (args.length !== 0) throw new Error('Invalid update request');
      return action();
    });
  };
  const open = (kind: 'downloadUrl' | 'releaseUrl') => {
    const state = controller.getState();
    if (!state.isHost || !state.release) throw new Error('No update is available on this computer');
    const url = state.release[kind];
    if (!url) throw new Error('No installer is available for this computer');
    // These URLs come exclusively from the fixed-repository checker's validation.
    return shell.openExternal(url);
  };
  handle(UPDATE_CHANNELS.state, () => controller.getState());
  handle(UPDATE_CHANNELS.check, () => controller.check());
  handle(UPDATE_CHANNELS.download, () => {
    const state = controller.getState();
    if (!state.isHost || !state.release) throw new Error('No update is available on this computer');
    if (!state.release.downloadUrl) throw new Error('No installer is available for this computer');
    // Development/unsupported locations retain an explicit manual installer link.
    return state.canInstall === false ? open('downloadUrl') : controller.download();
  });
  handle(UPDATE_CHANNELS.install, () => {
    if (!controller.getState().isHost) throw new Error('No update is available on this computer');
    return controller.install();
  });
  handle(UPDATE_CHANNELS.cancel, () => {
    if (!controller.getState().isHost) throw new Error('No update is available on this computer');
    controller.cancelDownload();
  });
  handle(UPDATE_CHANNELS.release, () => open('releaseUrl'));
  return {
    broadcast(state) {
      for (const win of [windows.main(), windows.status()]) {
        if (trustedWindow(win, win?.webContents.mainFrame.url ?? ''))
          win!.webContents.send(UPDATE_CHANNELS.changed, state);
      }
    },
    dispose() {
      for (const channel of Object.values(UPDATE_CHANNELS)) {
        if (channel !== UPDATE_CHANNELS.changed) ipcMain.removeHandler(channel);
      }
    },
  };
}
