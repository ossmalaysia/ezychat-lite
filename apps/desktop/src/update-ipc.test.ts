import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { DesktopUpdateState } from '@wa-team-inbox/shared';
import { pathToFileURL } from 'node:url';

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
  openExternal: vi.fn(async () => undefined),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => mock.handlers.set(channel, handler),
    removeHandler: (channel: string) => mock.handlers.delete(channel),
  },
  shell: { openExternal: mock.openExternal },
}));
import { isUpdateHost, registerUpdateIpc, UPDATE_CHANNELS } from './update-ipc.js';

function windowFixture(url: string) {
  const mainFrame = { url };
  const webContents = { mainFrame, send: vi.fn() };
  const win = { webContents, isDestroyed: vi.fn(() => false) };
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  return { win, event, mainFrame };
}

function fixture() {
  const statusFile = 'C:\\app\\src\\renderer\\status.html';
  const main = windowFixture('http://127.0.0.1:7420/chats');
  const status = windowFixture(pathToFileURL(statusFile).href);
  let currentMain = main.win;
  let baseUrl = 'http://127.0.0.1:7420';
  const state: DesktopUpdateState = {
    isHost: true,
    currentVersion: '0.1.11',
    checkedAt: null,
    status: 'available',
    error: null,
    release: {
      version: '0.1.12',
      name: 'Release',
      notes: 'Changes',
      publishedAt: '2026-10-03T00:00:00Z',
      prerelease: true,
      releaseUrl: 'https://github.com/ossmalaysia/wa-team-inbox/releases/tag/v0.1.12',
      downloadUrl:
        'https://github.com/ossmalaysia/wa-team-inbox/releases/download/v0.1.12/WA-Team-Inbox-0.1.12-win-x64.exe',
      assetName: 'WA-Team-Inbox-0.1.12-win-x64.exe',
    },
  };
  const controller = {
    getState: vi.fn(() => state),
    check: vi.fn(async () => state),
  };
  const ipc = registerUpdateIpc(controller, {
    main: () => currentMain as unknown as BrowserWindow,
    status: () => status.win as unknown as BrowserWindow,
    baseUrl: () => baseUrl,
    statusFile,
  });
  const invoke = (channel: string, event = main.event, ...args: unknown[]) =>
    mock.handlers.get(channel)!(event, ...args);
  return {
    main,
    status,
    state,
    controller,
    ipc,
    invoke,
    replaceMain: () => {
      currentMain = windowFixture(main.mainFrame.url).win;
    },
    setBaseUrl: (url: string) => {
      baseUrl = url;
    },
  };
}

beforeEach(() => {
  mock.handlers.clear();
  mock.openExternal.mockClear();
});

describe('desktop update IPC', () => {
  it('allows only the registered inbox and exact local status page', async () => {
    const { invoke, status, state, controller } = fixture();
    expect(invoke(UPDATE_CHANNELS.state)).toBe(state);
    expect(await invoke(UPDATE_CHANNELS.check, status.event)).toBe(state);
    expect(controller.check).toHaveBeenCalledOnce();
    await invoke(UPDATE_CHANNELS.download);
    expect(mock.openExternal).toHaveBeenCalledWith(state.release!.downloadUrl);
    await invoke(UPDATE_CHANNELS.release, status.event);
    expect(mock.openExternal).toHaveBeenCalledWith(state.release!.releaseUrl);
  });

  it('rejects unregistered windows, subframes, missing frames and destroyed windows', () => {
    const { main, invoke } = fixture();
    for (const event of [
      { ...main.event, sender: {} },
      { ...main.event, senderFrame: { url: main.mainFrame.url } },
      { ...main.event, senderFrame: null },
    ]) {
      expect(() => invoke(UPDATE_CHANNELS.check, event as IpcMainInvokeEvent)).toThrow('Forbidden');
    }
    main.win.isDestroyed.mockReturnValue(true);
    expect(() => invoke(UPDATE_CHANNELS.download)).toThrow('Forbidden');
    expect(mock.openExternal).not.toHaveBeenCalled();
  });

  it('rejects remote pages, origin lookalikes, credentials, old ports and other local files', () => {
    const { main, status, invoke, setBaseUrl } = fixture();
    for (const url of [
      'https://inbox.example/',
      'http://127.0.0.1.attacker.example:7420/',
      'http://localhost:7420/',
      'http://user:password@127.0.0.1:7420/',
      'http://127.0.0.1:7430/',
      'data:text/html,hello',
      'file:///tmp/status.html',
    ]) {
      main.mainFrame.url = url;
      expect(() => invoke(UPDATE_CHANNELS.check)).toThrow('Forbidden');
    }
    main.mainFrame.url = 'http://127.0.0.1:7420/';
    setBaseUrl('http://127.0.0.1:7430');
    expect(() => invoke(UPDATE_CHANNELS.check)).toThrow('Forbidden');
    main.mainFrame.url = 'http://127.0.0.1:7430/';
    expect(invoke(UPDATE_CHANNELS.state)).toBeTruthy();
    status.mainFrame.url += '?attacker=true';
    expect(() => invoke(UPDATE_CHANNELS.state, status.event)).toThrow('Forbidden');
  });

  it('never accepts a URL or other renderer arguments', () => {
    const { invoke, main, controller } = fixture();
    for (const channel of [
      UPDATE_CHANNELS.check,
      UPDATE_CHANNELS.download,
      UPDATE_CHANNELS.release,
    ]) {
      expect(() => invoke(channel, main.event, 'https://attacker.example/')).toThrow('Invalid');
    }
    expect(controller.check).not.toHaveBeenCalled();
    expect(mock.openExternal).not.toHaveBeenCalled();
  });

  it('blocks release actions after host ownership is lost or no release exists', () => {
    const { invoke, state } = fixture();
    state.isHost = false;
    expect(() => invoke(UPDATE_CHANNELS.release)).toThrow('No update');
    state.isHost = true;
    state.release = null;
    expect(() => invoke(UPDATE_CHANNELS.download)).toThrow('No update');
    expect(mock.openExternal).not.toHaveBeenCalled();
  });

  it('allows release details without an installer and retained newer releases during errors', async () => {
    const { invoke, state } = fixture();
    state.release!.downloadUrl = null;
    state.status = 'error';
    expect(() => invoke(UPDATE_CHANNELS.download)).toThrow('No installer');
    await invoke(UPDATE_CHANNELS.release);
    expect(mock.openExternal).toHaveBeenCalledWith(state.release!.releaseUrl);
  });

  it('sends state only to current trusted windows and removes handlers on dispose', () => {
    const { main, status, state, ipc, replaceMain, invoke } = fixture();
    ipc.broadcast(state);
    expect(main.win.webContents.send).toHaveBeenCalledWith(UPDATE_CHANNELS.changed, state);
    expect(status.win.webContents.send).toHaveBeenCalledWith(UPDATE_CHANNELS.changed, state);
    main.win.webContents.send.mockClear();
    status.mainFrame.url = 'file:///another-page.html';
    status.win.webContents.send.mockClear();
    replaceMain();
    expect(() => invoke(UPDATE_CHANNELS.state, main.event)).toThrow('Forbidden');
    ipc.broadcast(state);
    expect(main.win.webContents.send).not.toHaveBeenCalled();
    expect(status.win.webContents.send).not.toHaveBeenCalled();
    ipc.dispose();
    expect(mock.handlers.size).toBe(0);
  });
});

describe('hosting machine update ownership', () => {
  it('owns a standalone server or installed local service, including a stopped service', () => {
    expect(isUpdateHost('standalone', 'not-installed')).toBe(true);
    expect(isUpdateHost('client', 'running')).toBe(true);
    expect(isUpdateHost('error', 'stopped')).toBe(true);
    expect(isUpdateHost('starting', 'stopped')).toBe(true);
  });
  it('does not own independent external servers or unknown startup state', () => {
    expect(isUpdateHost('client', 'not-installed')).toBe(false);
    expect(isUpdateHost('starting', 'not-installed')).toBe(false);
    expect(isUpdateHost('error', 'not-installed')).toBe(false);
  });
});
