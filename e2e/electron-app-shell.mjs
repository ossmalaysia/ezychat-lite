// Electron main for e2e/electron-links.smoke.mjs: the desktop app's REAL main window
// (apps/desktop/dist/window.js createMainWindow, with its navigation and permission rules) on SMOKE_URL,
// with a throwaway profile. shell.openExternal is replaced by a recorder, so no mail app or browser opens:
// the test reads globalThis.__opened through electronApp.evaluate. Build the desktop app first
// (`npm run build -w @ezychat/desktop`).
import { app, nativeImage, shell } from 'electron';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop', 'dist');
globalThis.__opened = [];
shell.openExternal = async (url) => {
  globalThis.__opened.push(url);
};

app.setPath('userData', mkdtempSync(join(tmpdir(), 'ezychat-electron-links-')));
app.whenReady().then(async () => {
  const { createMainWindow } = await import(pathToFileURL(join(dist, 'window.js')).href);
  const base = process.env.SMOKE_BASE || 'http://127.0.0.1:7499';
  const win = createMainWindow({
    icon: nativeImage.createEmpty(),
    baseUrl: () => base,
    title: 'EzyChat (link test)',
    preload: join(dist, 'inbox-preload.cjs'),
  });
  void win.loadURL(base + '/login');
});
app.on('window-all-closed', () => app.quit());
