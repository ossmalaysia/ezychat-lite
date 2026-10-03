import {
  ipcMain,
  Notification,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type NativeImage,
} from 'electron';

export const NOTIFICATION_CHANNELS = {
  supported: 'wati:notifications-supported',
  show: 'wati:notifications-show',
  clear: 'wati:notifications-clear',
} as const;

type NotificationPayload = { title: string; body: string; url: string; tag: string };

/** Restrict activation to application routes, without URL parsing's path normalization. */
export function notificationPath(value: unknown): string | null {
  if (value === '/admin/whatsapp') return value;
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith('/chats/')) return null;
  const segment = value.slice('/chats/'.length);
  try {
    const jid = decodeURIComponent(segment);
    if (
      !jid ||
      /[\s/\\?#]/u.test(jid) ||
      [...jid].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    )
      return null;
    if (encodeURIComponent(jid) !== segment || jid === '.' || jid === '..') return null;
    return value;
  } catch {
    return null;
  }
}

function payloadFrom(value: unknown): NotificationPayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid notification');
  const p = value as Record<string, unknown>;
  const bounded = (v: unknown, max: number): v is string =>
    typeof v === 'string' && v.length <= max;
  const url = notificationPath(p.url);
  if (
    !bounded(p.title, 200) ||
    !p.title.trim() ||
    !bounded(p.body, 1000) ||
    !bounded(p.tag, 256) ||
    !p.tag.trim() ||
    !url
  )
    throw new Error('Invalid notification');
  return { title: p.title, body: p.body, tag: p.tag, url };
}

function sameOrigin(value: string, base: string | null): boolean {
  try {
    return !!base && new URL(value).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/** Native delivery while the inbox is in the background; no Chromium push registration needed. */
export function registerInboxNotifications(
  win: BrowserWindow,
  baseUrl: () => string | null,
  icon: NativeImage,
): void {
  const active = new Map<string, Notification>();
  const trusted = (e: IpcMainInvokeEvent): boolean =>
    !win.isDestroyed() &&
    e.sender === win.webContents &&
    e.senderFrame === win.webContents.mainFrame &&
    sameOrigin(e.senderFrame?.url ?? '', baseUrl());
  const clear = () => {
    const notifications = [...active.values()];
    active.clear();
    for (const n of notifications) n.close();
  };
  const handle = (channel: string, fn: (payload: unknown) => unknown) => {
    ipcMain.handle(channel, (e, payload: unknown) => {
      if (!trusted(e)) throw new Error('Forbidden notification request');
      return fn(payload);
    });
  };
  handle(NOTIFICATION_CHANNELS.supported, () => Notification.isSupported());
  handle(NOTIFICATION_CHANNELS.clear, clear);
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) clear();
  });
  win.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame && new URL(url).pathname === '/login') clear();
  });
  handle(NOTIFICATION_CHANNELS.show, (value) => {
    const payload = payloadFrom(value);
    if (!Notification.isSupported() || (win.isVisible() && win.isFocused())) return false;
    const existing = active.get(payload.tag);
    active.delete(payload.tag);
    existing?.close();
    // Retain objects for click events, but cap background memory and old message previews.
    if (active.size >= 50) {
      const first = active.entries().next().value;
      if (first) {
        active.delete(first[0]);
        first[1].close();
      }
    }
    const n = new Notification({ title: payload.title, body: payload.body, icon });
    active.set(payload.tag, n);
    const remove = () => {
      if (active.get(payload.tag) === n) active.delete(payload.tag);
    };
    n.on('click', () => {
      if (
        active.get(payload.tag) !== n ||
        win.isDestroyed() ||
        !sameOrigin(win.webContents.getURL(), baseUrl())
      )
        return;
      const base = baseUrl();
      if (!base) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      remove();
      void win.loadURL(new URL(payload.url, base).href).catch((error) => {
        console.error(
          JSON.stringify({
            mod: 'desktop',
            event: 'notification_navigation_failed',
            error: String(error),
          }),
        );
      });
    });
    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(
        () => finish(new Error('Desktop notification delivery timed out')),
        5000,
      );
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          remove();
          n.close();
          reject(error);
        } else resolve(true);
      };
      n.once('show', () => finish());
      n.on('close', () => {
        remove();
        finish(new Error('Desktop notification was closed before delivery'));
      });
      n.on('failed', (_event, error: string) => {
        remove();
        console.error(JSON.stringify({ mod: 'desktop', event: 'notification_failed', error }));
        finish(new Error(error || 'Desktop notification delivery failed'));
      });
      try {
        n.show();
      } catch (error) {
        finish(error);
      }
    });
  });
  win.once('closed', () => {
    clear();
    for (const channel of Object.values(NOTIFICATION_CHANNELS)) ipcMain.removeHandler(channel);
  });
}
