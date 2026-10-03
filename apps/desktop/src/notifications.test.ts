import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent, NativeImage } from 'electron';

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>(),
  instances: [] as Array<
    EventEmitter & { show: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }
  >,
  supported: true,
  autoShow: true,
}));
vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    ipcMain: {
      handle: (channel: string, fn: (event: IpcMainInvokeEvent, payload?: unknown) => unknown) =>
        mock.handlers.set(channel, fn),
      removeHandler: (channel: string) => mock.handlers.delete(channel),
    },
    Notification: class extends Emitter {
      static isSupported() {
        return mock.supported;
      }
      show = vi.fn(() => {
        if (mock.autoShow) this.emit('show');
      });
      close = vi.fn(() => this.emit('close'));
      constructor(readonly options: unknown) {
        super();
        mock.instances.push(this);
      }
    },
  };
});
import {
  NOTIFICATION_CHANNELS,
  notificationPath,
  registerInboxNotifications,
} from './notifications.js';

function fixture() {
  const mainFrame = { url: 'http://127.0.0.1:7420/' };
  const webContents = Object.assign(new EventEmitter(), { mainFrame, getURL: () => mainFrame.url });
  const win = Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    isFocused: vi.fn(() => false),
    isMinimized: vi.fn(() => true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(async () => undefined),
  });
  registerInboxNotifications(
    win as unknown as BrowserWindow,
    () => 'http://127.0.0.1:7420',
    {} as NativeImage,
  );
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  const invoke = (channel: string, payload?: unknown, sender = event) =>
    mock.handlers.get(channel)!(sender, payload);
  return { win, event, invoke, mainFrame };
}
const payload = {
  title: 'New message',
  body: 'Hello',
  tag: 'chat:1',
  url: '/chats/123%40s.whatsapp.net',
};

beforeEach(() => {
  mock.handlers.clear();
  mock.instances.length = 0;
  mock.supported = true;
  mock.autoShow = true;
});

describe('native inbox notifications', () => {
  it('checks native support and suppresses delivery only when the inbox is visible and focused', async () => {
    const { win, invoke } = fixture();
    expect(invoke(NOTIFICATION_CHANNELS.supported)).toBe(true);
    win.isVisible.mockReturnValue(true);
    win.isFocused.mockReturnValue(true);
    expect(invoke(NOTIFICATION_CHANNELS.show, payload)).toBe(false);
    expect(mock.instances).toHaveLength(0);
    win.isFocused.mockReturnValue(false);
    expect(await invoke(NOTIFICATION_CHANNELS.show, payload)).toBe(true);
    expect(mock.instances[0]?.show).toHaveBeenCalledOnce();
    mock.supported = false;
    expect(invoke(NOTIFICATION_CHANNELS.supported)).toBe(false);
    expect(invoke(NOTIFICATION_CHANNELS.show, { ...payload, tag: 'other' })).toBe(false);
  });

  it('rejects other windows, subframes, non-local origins and destroyed windows', () => {
    const { win, invoke, event, mainFrame } = fixture();
    for (const sender of [
      { ...event, sender: {} },
      { ...event, senderFrame: { url: mainFrame.url } },
      { ...event, senderFrame: null },
    ])
      expect(() =>
        invoke(NOTIFICATION_CHANNELS.show, payload, sender as IpcMainInvokeEvent),
      ).toThrow('Forbidden');
    mainFrame.url = 'https://attacker.example/';
    expect(() => invoke(NOTIFICATION_CHANNELS.clear)).toThrow('Forbidden');
    mainFrame.url = 'http://127.0.0.1:7420/';
    win.isDestroyed.mockReturnValue(true);
    expect(() => invoke(NOTIFICATION_CHANNELS.supported)).toThrow('Forbidden');
  });

  it('restores and navigates to the safe chat route on click', () => {
    const { win, invoke } = fixture();
    invoke(NOTIFICATION_CHANNELS.show, payload);
    mock.instances[0]!.emit('click');
    expect(win.restore).toHaveBeenCalledOnce();
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
    expect(win.loadURL).toHaveBeenCalledWith('http://127.0.0.1:7420/chats/123%40s.whatsapp.net');
  });

  it('does not activate a notification after navigating away from the inbox', () => {
    const { win, invoke, mainFrame } = fixture();
    invoke(NOTIFICATION_CHANNELS.show, payload);
    mainFrame.url = 'data:text/html,starting';
    mock.instances[0]!.emit('click');
    expect(win.show).not.toHaveBeenCalled();
    expect(win.loadURL).not.toHaveBeenCalled();
  });

  it('waits for native delivery acknowledgement', async () => {
    mock.autoShow = false;
    const { invoke } = fixture();
    let delivered = false;
    const result = Promise.resolve(invoke(NOTIFICATION_CHANNELS.show, payload)).then((value) => {
      delivered = true;
      return value;
    });
    await Promise.resolve();
    expect(delivered).toBe(false);
    mock.instances[0]!.emit('show');
    expect(await result).toBe(true);
  });

  it('rejects native delivery failure so the web client can report it to the server log', async () => {
    mock.autoShow = false;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { invoke } = fixture();
    const result = invoke(NOTIFICATION_CHANNELS.show, payload);
    mock.instances[0]!.emit('failed', {}, 'OS delivery failed');
    await expect(result).rejects.toThrow('OS delivery failed');
    expect(mock.instances[0]!.close).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it('bounds acknowledgement waiting and closes the timed-out notification', async () => {
    vi.useFakeTimers();
    try {
      mock.autoShow = false;
      const { invoke } = fixture();
      const rejected = expect(invoke(NOTIFICATION_CHANNELS.show, payload)).rejects.toThrow(
        'timed out',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejected;
      expect(mock.instances[0]!.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears notification previews on full navigation and in-page login', () => {
    const { win, invoke } = fixture();
    invoke(NOTIFICATION_CHANNELS.show, payload);
    win.webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
    expect(mock.instances[0]!.close).not.toHaveBeenCalled();
    win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(mock.instances[0]!.close).toHaveBeenCalledOnce();
    mock.instances[0]!.emit('click');
    expect(win.loadURL).not.toHaveBeenCalled();
    invoke(NOTIFICATION_CHANNELS.show, payload);
    win.webContents.emit('did-navigate-in-page', {}, 'http://127.0.0.1:7420/login', true);
    expect(mock.instances[1]!.close).toHaveBeenCalledOnce();
  });

  it('replaces a chat notification, bounds retained notifications and clears on logout', () => {
    const { invoke } = fixture();
    invoke(NOTIFICATION_CHANNELS.show, payload);
    invoke(NOTIFICATION_CHANNELS.show, payload);
    expect(mock.instances[0]!.close).toHaveBeenCalledOnce();
    for (let i = 0; i < 50; i++) invoke(NOTIFICATION_CHANNELS.show, { ...payload, tag: String(i) });
    expect(mock.instances[1]!.close).toHaveBeenCalledOnce();
    invoke(NOTIFICATION_CHANNELS.clear);
    expect(mock.instances.every((n) => n.close.mock.calls.length === 1)).toBe(true);
  });

  it('removes its handlers and notifications when the inbox window is destroyed', () => {
    const { win, invoke } = fixture();
    invoke(NOTIFICATION_CHANNELS.show, payload);
    win.emit('closed');
    expect(mock.instances[0]!.close).toHaveBeenCalledOnce();
    expect(mock.handlers.size).toBe(0);
  });

  it('rejects excessive payloads and invalid activation paths', () => {
    const { invoke } = fixture();
    for (const p of [
      null,
      {},
      { ...payload, title: 'x'.repeat(201) },
      { ...payload, body: 'x'.repeat(1001) },
      { ...payload, tag: 'x'.repeat(257) },
      { ...payload, title: ' ' },
      { ...payload, url: '//attacker.example/' },
    ]) {
      expect(() => invoke(NOTIFICATION_CHANNELS.show, p)).toThrow('Invalid notification');
    }
    expect(mock.instances).toHaveLength(0);
  });
});

describe('notification activation paths', () => {
  it.each(['/chats/123%40s.whatsapp.net', '/chats/123%3A4%40lid', '/admin/whatsapp'])(
    'accepts %s',
    (path) => {
      expect(notificationPath(path)).toBe(path);
    },
  );
  it.each([
    'https://evil.example/',
    '//evil.example/',
    '/admin/members',
    '/admin/whatsapp?next=evil',
    '/chats/',
    '/chats/..',
    '/chats/%2E%2E',
    '/chats/foo/bar',
    '/chats/foo%2Fbar',
    '/chats/foo%5Cbar',
    '/chats/foo?bar',
    '/chats/foo%3Fbar',
    '/chats/foo%23bar',
    '/chats/foo%0Abar',
    '/chats/%ZZ',
    '/chats/123@s.whatsapp.net',
  ])('rejects %s', (path) => {
    expect(notificationPath(path)).toBeNull();
  });
});
