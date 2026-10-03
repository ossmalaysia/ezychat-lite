import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { pathToFileURL } from 'node:url';

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>,
    ) => mock.handlers.set(channel, fn),
    removeHandler: (channel: string) => mock.handlers.delete(channel),
  },
}));
import { broadcastStatusChanged, CHANNELS, registerIpc, type DesktopController } from './ipc.js';

function fixture() {
  const file = 'C:\\app\\src\\renderer\\status.html';
  const mainFrame = { url: pathToFileURL(file).href };
  const webContents = { mainFrame, send: vi.fn() };
  const win = { webContents, isDestroyed: vi.fn(() => false) };
  const controller = Object.fromEntries(
    [
      'getStatus',
      'enableService',
      'disableService',
      'startService',
      'stopService',
      'resetAdmin',
      'openMain',
      'openLogsFolder',
    ].map((name) => [name, vi.fn(async () => undefined)]),
  ) as unknown as DesktopController;
  let current: typeof win | null = win;
  const ipc = registerIpc(controller, () => current as unknown as BrowserWindow | null, file);
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  const invoke = (channel: string, sender = event, ...args: unknown[]) =>
    mock.handlers.get(channel)!(sender, ...args);
  return {
    file,
    mainFrame,
    win,
    controller,
    ipc,
    event,
    invoke,
    setCurrent: (value: typeof win | null) => {
      current = value;
    },
  };
}

beforeEach(() => mock.handlers.clear());

describe('privileged status IPC', () => {
  it('permits the registered status main frame to use the host controls', async () => {
    const { invoke, controller } = fixture();
    await invoke(CHANNELS.resetAdmin);
    expect(controller.resetAdmin).toHaveBeenCalledOnce();
    await invoke(CHANNELS.enableService);
    expect(controller.enableService).toHaveBeenCalledOnce();
  });

  it('rejects unrelated windows, subframes and missing frames even with the exact file URL', async () => {
    const { invoke, event, controller, mainFrame } = fixture();
    for (const sender of [
      { ...event, sender: {} },
      { ...event, senderFrame: { url: mainFrame.url } },
      { ...event, senderFrame: null },
    ]) {
      await expect(invoke(CHANNELS.resetAdmin, sender as IpcMainInvokeEvent)).rejects.toThrow(
        'Forbidden',
      );
    }
    expect(controller.resetAdmin).not.toHaveBeenCalled();
  });

  it('rejects arbitrary local files, URL suffixes, remote pages and stale windows', async () => {
    const { invoke, mainFrame, win, controller, setCurrent } = fixture();
    const original = mainFrame.url;
    for (const url of [
      'file:///tmp/status.html',
      original + '?fake=true',
      original + '#fake',
      'http://127.0.0.1:7420/',
      'data:text/html,hello',
    ]) {
      mainFrame.url = url;
      await expect(invoke(CHANNELS.enableService)).rejects.toThrow('Forbidden');
    }
    mainFrame.url = original;
    win.isDestroyed.mockReturnValue(true);
    await expect(invoke(CHANNELS.enableService)).rejects.toThrow('Forbidden');
    win.isDestroyed.mockReturnValue(false);
    setCurrent(null);
    await expect(invoke(CHANNELS.enableService)).rejects.toThrow('Forbidden');
    expect(controller.enableService).not.toHaveBeenCalled();
  });

  it('rejects renderer arguments for every privileged handler and cleans up on shutdown', async () => {
    const { invoke, event, ipc } = fixture();
    for (const channel of Object.values(CHANNELS).filter((value) => value !== CHANNELS.changed)) {
      await expect(invoke(channel, event, 'attacker data')).rejects.toThrow('Invalid');
    }
    ipc.dispose();
    expect(mock.handlers.size).toBe(0);
  });

  it('broadcasts only to the exact current status page', () => {
    const { file, win, mainFrame } = fixture();
    broadcastStatusChanged(win as unknown as BrowserWindow, file);
    expect(win.webContents.send).toHaveBeenCalledWith(CHANNELS.changed);
    win.webContents.send.mockClear();
    mainFrame.url = 'file:///tmp/attacker.html';
    broadcastStatusChanged(win as unknown as BrowserWindow, file);
    win.isDestroyed.mockReturnValue(true);
    broadcastStatusChanged(win as unknown as BrowserWindow, file);
    broadcastStatusChanged(null, file);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});
