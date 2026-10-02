// Electron main process: single instance, detect service / start standalone server, window, tray,
// status & service control.
import { app, clipboard, dialog, nativeImage, shell, type BrowserWindow, type NativeImage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeServer, waitForServer } from './detect.js';
import { iconPng } from './icon.js';
import { broadcastStatusChanged, registerIpc, type DesktopController, type DesktopMode, type DesktopStatus } from './ipc.js';
import {
  cloudflaredBinary,
  cloudflaredDir,
  machineDataDir,
  parseDesktopConfig,
  serverEntry,
  userDataDir,
  webDistDir,
  winswExe,
} from './paths.js';
import { runServerCommand, StandaloneServer } from './server-process.js';
import { createServiceManager, type ServiceManager, type ServiceState } from './service/index.js';
import { createTray } from './tray.js';
import { createMainWindow, createStatusWindow, messagePage } from './window.js';

const here = dirname(fileURLToPath(import.meta.url));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('org.ossmalaysia.wateaminbox');
  void main();
}

function readDesktopConfig(): { port: number } {
  const file = join(app.getPath('userData'), 'desktop.json');
  const cfg = parseDesktopConfig(existsSync(file) ? readFileSync(file, 'utf8') : null);
  if (!existsSync(file)) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(cfg, null, 2));
    } catch {
      // best effort
    }
  }
  return cfg;
}

async function main(): Promise<void> {
  await app.whenReady();

  const isPackaged = app.isPackaged;
  const resourcesPath = process.resourcesPath;
  const appPath = app.getAppPath();
  const { port } = readDesktopConfig();
  const url = `http://127.0.0.1:${port}`;
  const entry = serverEntry(isPackaged, resourcesPath, appPath);
  const webDist = webDistDir(isPackaged, resourcesPath, appPath);
  const cfDir = cloudflaredDir(isPackaged, resourcesPath, appPath);
  const cfBin = cloudflaredBinary(cfDir);
  const dataDir = userDataDir(app);
  // utilityProcess everywhere; WATI_DESKTOP_RUNTIME=node (dev only) runs the server with the
  // system node instead, e.g. if a native module in node_modules was built for Node's ABI only.
  const runtime: 'utility' | 'node' = !isPackaged && process.env.WATI_DESKTOP_RUNTIME === 'node' ? 'node' : 'utility';
  const version = app.getVersion();
  const desktopLog: string[] = [];
  const log = (s: string) => {
    desktopLog.push(s);
    if (desktopLog.length > 200) desktopLog.shift();
    if (!isPackaged) process.stdout.write(`${s}\n`);
  };

  const appIcon: NativeImage = nativeImage.createFromBuffer(iconPng(256));
  const trayIcon: NativeImage =
    process.platform === 'darwin'
      ? (() => {
          const img = nativeImage.createFromBuffer(iconPng(32, { monochrome: true }), { scaleFactor: 2 });
          img.setTemplateImage(true);
          return img;
        })()
      : nativeImage.createFromBuffer(iconPng(32));

  const service: ServiceManager = createServiceManager(process.platform, {
    execPath: process.execPath,
    serverEntry: entry,
    webDist,
    cloudflaredBinary: cfBin,
    cloudflaredDir: cfDir,
    winswExe: winswExe(isPackaged, resourcesPath, appPath),
    userDataDir: dataDir,
    machineDataDir: machineDataDir(),
    port,
    version,
    log,
  });
  const serviceSupported = process.platform === 'win32' || process.platform === 'darwin';

  let mode: DesktopMode = 'starting';
  let busy: string | null = null;
  let quitting = false;
  let mainWindow: BrowserWindow | null = null;
  let statusWindow: BrowserWindow | null = null;
  let lastServiceState: ServiceState = 'not-installed';

  const server = new StandaloneServer({
    entry,
    dataDir,
    port,
    webDist,
    cloudflaredDir: cfDir,
    cloudflaredBinary: cfBin,
    version,
    runtime,
    log,
  });
  server.on('state', () => {
    trayHandle.refresh();
    broadcastStatusChanged();
  });

  const describe = (): string => {
    if (busy) return busy;
    if (mode === 'client') return 'Background service — connected';
    if (mode === 'standalone') return `Standalone — ${server.state}`;
    if (mode === 'error') return 'Server not running';
    return 'Starting…';
  };

  const setMode = (m: DesktopMode) => {
    mode = m;
    trayHandle.refresh();
    broadcastStatusChanged();
  };
  const setBusy = (b: string | null) => {
    busy = b;
    trayHandle.refresh();
    broadcastStatusChanged();
  };

  const showMain = (path = '/') => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow({ icon: appIcon, baseUrl: () => url });
      mainWindow.on('close', (e) => {
        if (quitting) return;
        if (mode === 'client') {
          // the background service keeps running; the window is just a client
          quitting = true;
          app.quit();
          return;
        }
        e.preventDefault();
        mainWindow?.hide();
      });
      if (mode === 'standalone' || mode === 'client') void mainWindow.loadURL(url + path);
      else void mainWindow.loadURL(messagePage('Starting WA Team Inbox…', 'Starting the local server.'));
    } else if (path !== '/') {
      void mainWindow.loadURL(url + path);
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  const loadMain = (target: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(target);
  };

  const openStatus = () => {
    if (statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.show();
      statusWindow.focus();
      return;
    }
    statusWindow = createStatusWindow({
      icon: appIcon,
      preload: join(here, 'preload.cjs'),
      html: join(appPath, 'src', 'renderer', 'status.html'),
    });
    statusWindow.on('closed', () => (statusWindow = null));
  };

  const errorBox = (title: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[desktop] ${title}: ${msg}`);
    void dialog.showMessageBox({ type: 'error', title: 'WA Team Inbox', message: title, detail: msg });
  };

  const startStandalone = async (): Promise<boolean> => {
    setMode('starting');
    loadMain(messagePage('Starting WA Team Inbox…', 'Starting the local server.'));
    server.start();
    const ok = await waitForServer(port, { timeoutMs: 45_000 });
    if (ok) {
      setMode('standalone');
      loadMain(url);
      return true;
    }
    setMode('error');
    loadMain(
      messagePage(
        'The server did not start',
        `Port ${port} may be in use by another program. Open "Status & Service…" from the tray for logs.`,
      ),
    );
    return false;
  };

  const connectOrStart = async () => {
    const probe = await probeServer(port);
    if (probe) {
      log(`[desktop] found running server (mode ${probe.mode}, v${probe.version}) on port ${port}`);
      setMode('client');
      loadMain(url);
      return;
    }
    await startStandalone();
  };

  const resetAdmin = async () => {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Reset admin password',
      message: 'Reset the first admin account password?',
      detail: 'A new temporary password is generated and all of that admin’s sessions are signed out.',
      buttons: ['Reset password', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return;
    try {
      let output: string;
      if (mode === 'client') {
        const st = await service.status();
        if (st === 'not-installed') throw new Error('The running server is not managed by this app; reset it where it runs.');
        setBusy('Resetting admin password…');
        output = await service.resetAdmin();
      } else {
        setBusy('Resetting admin password…');
        await server.stop();
        const r = await runServerCommand({ entry, args: ['--data', dataDir, '--reset-admin'], runtime });
        output = r.output;
        void startStandalone();
        if (r.code !== 0) throw new Error(output || `reset failed (exit ${r.code})`);
      }
      setBusy(null);
      const m = /password for (.+?): (\S+)/.exec(output);
      const { response: r2 } = await dialog.showMessageBox({
        type: 'info',
        title: 'Admin password reset',
        message: m ? `New password for ${m[1]}:` : 'Admin password reset',
        detail: m ? `${m[2]}\n\nYou will be asked to change it after signing in.` : output,
        buttons: m ? ['Copy password', 'Close'] : ['Close'],
        defaultId: 0,
      });
      if (m && r2 === 0) clipboard.writeText(m[2] ?? '');
    } catch (err) {
      setBusy(null);
      errorBox('Could not reset the admin password', err);
    }
  };

  const controller: DesktopController = {
    async getStatus(): Promise<DesktopStatus> {
      try {
        lastServiceState = serviceSupported ? await service.status() : 'not-installed';
      } catch {
        // keep last
      }
      return {
        mode,
        serverState: mode === 'client' ? 'external' : server.state,
        serviceState: lastServiceState,
        serviceSupported,
        port,
        url,
        dataDir: mode === 'client' && lastServiceState !== 'not-installed' ? machineDataDir() : dataDir,
        version,
        platform: process.platform,
        busy,
        logs: [...desktopLog.slice(-60)],
      };
    },
    async enableService() {
      const { response } = await dialog.showMessageBox({
        type: 'question',
        title: 'Run as background service',
        message: 'Run WA Team Inbox as a background service?',
        detail:
          'The server will start when this computer boots, even when nobody is signed in. Your data moves to a machine-wide folder:\n' +
          machineDataDir() +
          '\n\nYou will be asked for administrator permission.',
        buttons: ['Enable service', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response !== 0) return;
      setBusy('Installing service…');
      try {
        await server.stop();
        await service.install();
        setBusy('Waiting for the service to start…');
        const ok = await waitForServer(port, { timeoutMs: 60_000 });
        if (!ok) throw new Error('The service was installed but did not answer on port ' + port + '.');
        setMode('client');
        loadMain(url);
      } catch (err) {
        errorBox('Could not enable the background service', err);
        if (!(await probeServer(port))) void startStandalone();
      } finally {
        setBusy(null);
      }
    },
    async disableService() {
      const { response } = await dialog.showMessageBox({
        type: 'question',
        title: 'Stop background service',
        message: 'Remove the background service and run inside this app again?',
        detail: 'Your data moves back to your user profile. You will be asked for administrator permission.',
        buttons: ['Remove service', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response !== 0) return;
      setBusy('Removing service…');
      try {
        await service.uninstall();
        setBusy(null);
        await startStandalone();
      } catch (err) {
        errorBox('Could not remove the background service', err);
      } finally {
        setBusy(null);
      }
    },
    async startService() {
      setBusy('Starting service…');
      try {
        await service.start();
        if (await waitForServer(port, { timeoutMs: 30_000 })) {
          setMode('client');
          loadMain(url);
        }
      } catch (err) {
        errorBox('Could not start the service', err);
      } finally {
        setBusy(null);
      }
    },
    async stopService() {
      setBusy('Stopping service…');
      try {
        await service.stop();
        loadMain(messagePage('Service stopped', 'Start the service again from "Status & Service…".'));
        setMode('error');
      } catch (err) {
        errorBox('Could not stop the service', err);
      } finally {
        setBusy(null);
      }
    },
    resetAdmin,
    openMain: () => showMain(),
    openLogsFolder: () => {
      const dir = join(mode === 'client' ? machineDataDir() : dataDir, 'logs');
      void shell.openPath(existsSync(dir) ? dir : dirname(dir));
    },
  };

  registerIpc(controller);

  const trayHandle = createTray(trayIcon, {
    open: () => showMain(),
    openStatus,
    openTunnelAdmin: () => showMain('/admin/tunnel'),
    resetAdmin: () => void resetAdmin(),
    quit: () => {
      quitting = true;
      app.quit();
    },
    describe,
  });

  app.on('second-instance', () => showMain());
  app.on('activate', () => showMain());
  app.on('window-all-closed', () => {
    // keep running in the tray (standalone)
  });
  let finalStopDone = false;
  app.on('before-quit', (e) => {
    quitting = true;
    if (finalStopDone || server.state === 'stopped') return;
    e.preventDefault();
    void server.stop().finally(() => {
      finalStopDone = true;
      app.quit();
    });
  });

  showMain();
  await connectOrStart();
}
