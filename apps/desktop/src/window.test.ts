// The window factories show their window once it is ready, also when Windows swallows the first show() of a
// process started hidden (the updater's relaunch of earlier versions).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ startedHidden: false, windows: [] as unknown[] }));

vi.mock('electron', () => {
  class BrowserWindow {
    private readonly handlers = new Map<string, () => void>();
    shows = 0;
    private visible = false;
    readonly webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
    };
    constructor() {
      fake.windows.push(this);
    }
    on = vi.fn();
    once(event: string, fn: () => void) {
      this.handlers.set(event, fn);
    }
    emit(event: string) {
      this.handlers.get(event)?.();
    }
    show() {
      this.shows++;
      if (!(fake.startedHidden && this.shows === 1)) this.visible = true;
    }
    isVisible() {
      return this.visible;
    }
    isDestroyed() {
      return false;
    }
    loadFile = vi.fn(async () => {});
    setTitle = vi.fn();
  }
  return {
    app: {},
    BrowserWindow,
    clipboard: { writeText: vi.fn() },
    Menu: { buildFromTemplate: vi.fn() },
    shell: { openExternal: vi.fn() },
  };
});
vi.mock('./notifications.js', () => ({ registerInboxNotifications: vi.fn() }));
vi.mock('./context-menu.js', () => ({ registerContextMenu: vi.fn() }));

import type { NativeImage } from 'electron';
import { createMainWindow, createStatusWindow } from './window.js';

type FakeWindow = { emit(event: string): void; isVisible(): boolean; shows: number };
const icon = {} as NativeImage;
const open = {
  main: () =>
    createMainWindow({
      icon,
      baseUrl: () => 'http://127.0.0.1:7420',
      title: 'EzyChat',
      preload: 'p.cjs',
      locale: 'en',
    }) as unknown as FakeWindow,
  status: () =>
    createStatusWindow({
      icon,
      preload: 'p.cjs',
      html: 's.html',
      title: 'EzyChat',
      locale: 'en',
    }) as unknown as FakeWindow,
};

beforeEach(() => {
  fake.startedHidden = false;
  fake.windows = [];
});

describe.each(Object.entries(open))('the %s window', (_name, create) => {
  it('shows once it is ready', () => {
    const win = create();
    expect(win.isVisible()).toBe(false);
    win.emit('ready-to-show');
    expect(win.isVisible()).toBe(true);
    expect(win.shows).toBe(1);
  });

  it('still appears when the app was started hidden (the updater relaunch)', () => {
    fake.startedHidden = true;
    const win = create();
    win.emit('ready-to-show');
    expect(win.isVisible()).toBe(true);
    expect(win.shows).toBe(2);
  });
});
