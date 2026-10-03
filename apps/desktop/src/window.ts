// BrowserWindow factories: the main inbox window (remote http://127.0.0.1:<port>) and the
// local status/control window (file:// + preload IPC).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, shell, type NativeImage, type Session } from 'electron';
import { registerInboxNotifications } from './notifications.js';

const SAFE_PREFS = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: true,
} as const;

function isSameOrigin(target: string, base: string): boolean {
  try {
    return new URL(target).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

function openExternalSafe(url: string): void {
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) void shell.openExternal(url);
}

/** Simple self-contained HTML page (data URL) used while the server starts or on errors. */
export function messagePage(title: string, body: string): string {
  const esc = (s: string) =>
    s.replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
    );
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>WA Team Inbox</title><style>
:root{color-scheme:light dark}body{margin:0;min-height:100dvh;display:grid;place-items:center;font:16px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a}
@media (prefers-color-scheme:dark){body{background:#0b1120;color:#e2e8f0}}
.c{max-width:28rem;padding:24px;text-align:center}.s{width:36px;height:36px;margin:0 auto 16px;border:4px solid #05966933;border-top-color:#059669;border-radius:50%;animation:r 1s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}h1{font-size:1.15rem;margin:0 0 8px}p{margin:0;opacity:.75;white-space:pre-wrap}
</style></head><body><div class="c"><div class="s"></div><h1>${esc(title)}</h1><p>${esc(body)}</p></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** Keeps `title` as the window title: the loaded page (web app / message page) sets its own. */
function pinTitle(win: BrowserWindow, title: string): void {
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.setTitle(title);
  });
}

/**
 * The web UI is a PWA: its service worker can keep serving JS from an older build after the app updates,
 * which then breaks against the new server. Clear the service worker + Cache Storage whenever the app
 * version changes (marker file in userData). Returns true when it cleared.
 */
export async function clearWebCacheOnVersionChange(
  ses: Session,
  version: string,
): Promise<boolean> {
  const marker = join(app.getPath('userData'), 'web-cache-version');
  let last = '';
  try {
    last = readFileSync(marker, 'utf8').trim();
  } catch {
    /* first run */
  }
  if (last === version) return false;
  await ses.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
  await ses.clearCache();
  try {
    writeFileSync(marker, version);
  } catch {
    /* non-fatal: we'll just clear again next start */
  }
  return true;
}

/** F12 / Ctrl+Shift+I: DevTools · Ctrl+R / F5: reload · Ctrl+Shift+R: reload bypassing the cache. */
function addDevShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const key = input.key.toLowerCase();
    if (input.key === 'F12' || (mod && input.shift && key === 'i')) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    } else if ((mod && input.shift && key === 'r') || (input.shift && input.key === 'F5')) {
      win.webContents.reloadIgnoringCache();
      e.preventDefault();
    } else if ((mod && key === 'r') || input.key === 'F5') {
      win.webContents.reload();
      e.preventDefault();
    }
  });
}

export function createMainWindow(o: {
  icon: NativeImage;
  baseUrl: () => string | null;
  title: string;
  preload: string;
}): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    title: o.title,
    icon: o.icon,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1120',
    webPreferences: { ...SAFE_PREFS, preload: o.preload, backgroundThrottling: false },
  });
  registerInboxNotifications(win, o.baseUrl, o.icon);
  pinTitle(win, o.title);
  addDevShortcuts(win);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const base = o.baseUrl();
    if (url.startsWith('data:')) return;
    if (base && isSameOrigin(url, base)) return;
    e.preventDefault();
    openExternalSafe(url);
  });
  // Notifications / clipboard are allowed for the local inbox only
  win.webContents.session.setPermissionRequestHandler((wc, permission, cb) => {
    const base = o.baseUrl();
    const ok =
      !!base &&
      isSameOrigin(wc.getURL(), base) &&
      ['notifications', 'clipboard-sanitized-write', 'media', 'fullscreen'].includes(permission);
    cb(ok);
  });
  return win;
}

export function createStatusWindow(o: {
  icon: NativeImage;
  preload: string;
  html: string;
  title: string;
}): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 680,
    minWidth: 360,
    minHeight: 420,
    title: `${o.title} — Status & Service`,
    icon: o.icon,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { ...SAFE_PREFS, preload: o.preload },
  });
  pinTitle(win, `${o.title} — Status & Service`);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  void win.loadFile(o.html);
  return win;
}
