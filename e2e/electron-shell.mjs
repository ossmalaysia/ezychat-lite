// Minimal Electron main used by e2e/electron-screens.smoke.mjs: one window on SMOKE_URL with the same
// webPreferences as the desktop app (apps/desktop/src/window.ts), using a throwaway profile.
import { app, BrowserWindow } from 'electron';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

app.setPath('userData', mkdtempSync(join(tmpdir(), 'wati-electron-smoke-')));
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  void win.loadURL(process.env.SMOKE_URL || 'http://127.0.0.1:7499/login');
});
app.on('window-all-closed', () => app.quit());
