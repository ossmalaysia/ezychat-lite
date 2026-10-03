// Electron main process: single instance, detect service / start standalone server, window, tray,
// status & service control.
import {
  app,
  clipboard,
  dialog,
  nativeImage,
  session,
  shell,
  type BrowserWindow,
  type NativeImage,
} from 'electron';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appTitle } from './app-title.js';
import { probeServer } from './detect.js';
import { iconPng } from './icon.js';
import {
  broadcastStatusChanged,
  registerIpc,
  type DesktopController,
  type DesktopMode,
  type DesktopStatus,
} from './ipc.js';
import {
  cloudflaredBinary,
  cloudflaredDir,
  machineDataDir,
  parseDesktopConfig,
  serverEntry,
  serverHost,
  servicePortFile,
  standalonePortFile,
  trayIconFile,
  userDataDir,
  webDistDir,
  winswExe,
} from './paths.js';
import { runServerCommand, StandaloneServer } from './server-process.js';
import { createServiceOperation } from './service-operation.js';
import { decideStartup, parsePortFile } from './startup.js';
import { createServiceManager, type ServiceManager, type ServiceState } from './service/index.js';
import { createTray } from './tray.js';
import {
  clearWebCacheOnVersionChange,
  createMainWindow,
  createStatusWindow,
  messagePage,
} from './window.js';

const here = dirname(fileURLToPath(import.meta.url));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('org.ossmalaysia.wateaminbox');
  void main();
}

function desktopConfigFile(): string {
  return join(app.getPath('userData'), 'desktop.json');
}

function readDesktopConfig(): { port: number } {
  const file = desktopConfigFile();
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

/** Remembers the port the server actually uses (e.g. after a port change in Admin > Settings). */
function writeDesktopPort(port: number): void {
  const file = desktopConfigFile();
  try {
    const cur = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)
      : {};
    writeFileSync(file, JSON.stringify({ ...cur, port }, null, 2));
  } catch {
    // best effort
  }
}

function readPortFile(file: string): number | null {
  try {
    return parsePortFile(existsSync(file) ? readFileSync(file, 'utf8') : null);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  await app.whenReady();

  const isPackaged = app.isPackaged;
  const resourcesPath = process.resourcesPath;
  const appPath = app.getAppPath();
  let { port } = readDesktopConfig();
  let url = `http://127.0.0.1:${port}`;
  const entry = serverEntry(isPackaged, resourcesPath, appPath);
  const webDist = webDistDir(isPackaged, resourcesPath, appPath);
  const cfDir = cloudflaredDir(isPackaged, resourcesPath, appPath);
  const cfBin = cloudflaredBinary(cfDir);
  const dataDir = userDataDir(app);
  // utilityProcess everywhere; WATI_DESKTOP_RUNTIME=node (dev only) runs the server with the
  // system node instead, e.g. if a native module in node_modules was built for Node's ABI only.
  const runtime: 'utility' | 'node' =
    !isPackaged && process.env.WATI_DESKTOP_RUNTIME === 'node' ? 'node' : 'utility';
  const version = app.getVersion();
  // Builds share a version during development, so key the web cache on the web build's index.html too.
  let webBuildKey = version;
  try {
    webBuildKey = `${version}:${statSync(join(webDist, 'index.html')).mtimeMs}`;
  } catch {
    // dev without a web build: version only
  }
  await clearWebCacheOnVersionChange(session.defaultSession, webBuildKey).catch(() => false);
  const desktopLog: string[] = [];
  const log = (s: string) => {
    desktopLog.push(s);
    if (desktopLog.length > 200) desktopLog.shift();
    if (!isPackaged) process.stdout.write(`${s}\n`);
  };

  const appIcon: NativeImage = nativeImage.createFromBuffer(iconPng(256));
  // Tray icon from build/tray (resources/tray when packaged); generated icon if missing/unreadable.
  const trayIcon: NativeImage = (() => {
    const mac = process.platform === 'darwin';
    const file = trayIconFile(isPackaged, resourcesPath, appPath);
    let img = existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
    if (img.isEmpty()) {
      log(`tray icon not found at ${file}; using generated icon`);
      img = mac
        ? nativeImage.createFromBuffer(iconPng(32, { monochrome: true }), { scaleFactor: 2 })
        : nativeImage.createFromBuffer(iconPng(32));
    }
    if (mac) img.setTemplateImage(true);
    return img;
  })();

  const host = serverHost(appPath);
  // macOS: <X>.app/Contents/MacOS/<X> → <X>.app (only meaningful when packaged)
  const appBundle =
    process.platform === 'darwin' && isPackaged
      ? dirname(dirname(dirname(process.execPath)))
      : null;
  const service: ServiceManager = createServiceManager(process.platform, {
    execPath: process.execPath,
    serverHost: host,
    appBundle,
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
    host,
    portFile: standalonePortFile(app.getPath('userData')),
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

  /** Switches to the port the server actually listens on (persisted port setting). */
  const adoptPort = (p: number) => {
    if (p === port) return;
    log(`[desktop] server port is now ${p} (was ${port})`);
    port = p;
    url = `http://127.0.0.1:${port}`;
    writeDesktopPort(port);
    broadcastStatusChanged();
  };
  server.on('port', (p: number) => adoptPort(p));
  const adoptServicePort = () => {
    const p = readPortFile(servicePortFile());
    if (p !== null) adoptPort(p);
  };

  /** Polls for the OS service (re-reading its port file) until it answers or the deadline passes. */
  const waitForService = async (timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      adoptServicePort();
      if (await probeServer(port)) return true;
      await new Promise((r) => setTimeout(r, 750));
    }
    return false;
  };

  const serviceDown = (state: ServiceState) => {
    setMode('error');
    loadMain(
      messagePage(
        state === 'running'
          ? 'The background service is not answering'
          : 'The background service is not running',
        'WA Team Inbox runs as a background service on this computer. Open "Status & Service…" from the tray to start it or to see its logs.',
      ),
    );
  };

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
      mainWindow = createMainWindow({
        icon: appIcon,
        baseUrl: () => url,
        title: appTitle(version),
        preload: join(here, 'inbox-preload.cjs'),
      });
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
      else
        void mainWindow.loadURL(
          messagePage('Starting WA Team Inbox…', 'Starting the local server.'),
        );
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
      title: appTitle(version),
    });
    statusWindow.on('closed', () => (statusWindow = null));
  };

  const errorBox = (title: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[desktop] ${title}: ${msg}`);
    void dialog.showMessageBox({
      type: 'error',
      title: 'WA Team Inbox',
      message: title,
      detail: msg,
    });
  };
  const runOperation = createServiceOperation(setBusy, errorBox);

  const startStandalone = async (): Promise<boolean> => {
    setMode('starting');
    loadMain(messagePage('Starting WA Team Inbox…', 'Starting the local server.'));
    server.start();
    const ok = await server.waitRunning(45_000);
    adoptPort(server.port);
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

  const currentServiceState = async (): Promise<ServiceState> => {
    if (!serviceSupported) return 'not-installed';
    try {
      lastServiceState = await service.status();
    } catch {
      // keep last
    }
    return lastServiceState;
  };

  const connectOrStart = async () => {
    const svc = await currentServiceState();
    if (svc !== 'not-installed') adoptServicePort();
    const probe = await probeServer(port);
    const action = decideStartup(probe !== null, svc);
    if (action === 'client') {
      log(
        `[desktop] found running server (mode ${probe?.mode}, v${probe?.version}) on port ${port}`,
      );
      setMode('client');
      loadMain(url);
      return;
    }
    if (action === 'wait-for-service') {
      // Never start a standalone server while the service is installed: its data moved to the
      // machine folder (the user folder is empty) and it would take the service's port.
      log(
        `[desktop] background service is ${svc} but not answering; not starting a standalone server`,
      );
      if (svc === 'running') {
        setMode('starting');
        loadMain(
          messagePage(
            'Connecting to the background service…',
            'Waiting for the WA Team Inbox service to start.',
          ),
        );
        if (await waitForService(60_000)) {
          setMode('client');
          loadMain(url);
          return;
        }
      }
      serviceDown(svc);
      return;
    }
    await startStandalone();
  };

  const resetAdmin = () =>
    runOperation('Confirming password reset…', 'Could not reset the admin password', async () => {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Reset admin password',
        message: 'Reset the first admin account password?',
        detail:
          'A new temporary password is generated and all of that admin’s sessions are signed out.',
        buttons: ['Reset password', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      });
      if (response !== 0) return;
      setBusy('Resetting admin password…');
      let output: string;
      if (mode === 'client') {
        const st = await service.status();
        if (st === 'not-installed')
          throw new Error('The running server is not managed by this app; reset it where it runs.');
        output = await service.resetAdmin();
      } else {
        await server.stop();
        const r = await runServerCommand({
          entry,
          args: ['--data', dataDir, '--reset-admin'],
          runtime,
        });
        output = r.output;
        await startStandalone();
        if (r.code !== 0) throw new Error(output || `reset failed (exit ${r.code})`);
      }
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
    });

  const controller: DesktopController = {
    async getStatus(): Promise<DesktopStatus> {
      try {
        lastServiceState = serviceSupported ? await service.status() : 'not-installed';
      } catch {
        // keep last
      }
      // server version / mode as reported by GET /api/health (the service may run another build)
      const health = mode === 'standalone' || mode === 'client' ? await probeServer(port) : null;
      return {
        mode,
        serverState: mode === 'client' ? 'external' : server.state,
        serviceState: lastServiceState,
        serviceSupported,
        port,
        url,
        dataDir:
          mode === 'client' && lastServiceState !== 'not-installed' ? machineDataDir() : dataDir,
        version,
        serverVersion: health?.version ?? null,
        serverMode: health?.mode ?? null,
        platform: process.platform,
        busy,
        logs: [...desktopLog.slice(-60)],
      };
    },
    enableService: () =>
      runOperation(
        'Confirming service installation…',
        'Could not enable the background service',
        async () => {
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
          await server.stop();
          await service.install();
          setBusy('Waiting for the service to start…');
          const ok = await waitForService(60_000);
          if (!ok)
            throw new Error('The service was installed but did not answer on port ' + port + '.');
          setMode('client');
          loadMain(url);
        },
        async () => {
          if (!(await probeServer(port))) {
            const svc = await currentServiceState();
            // installed but not answering: its data is in the machine folder now — don't start an
            // empty standalone server on the user folder
            if (svc === 'not-installed') await startStandalone();
            else serviceDown(svc);
          }
        },
      ),
    disableService: () =>
      runOperation(
        'Confirming service removal…',
        'Could not remove the background service',
        async () => {
          const { response } = await dialog.showMessageBox({
            type: 'question',
            title: 'Stop background service',
            message: 'Remove the background service and run inside this app again?',
            detail:
              'Your data moves back to your user profile. You will be asked for administrator permission.',
            buttons: ['Remove service', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
          });
          if (response !== 0) return;
          setBusy('Removing service…');
          await service.uninstall();
          setBusy('Starting the local server…');
          await startStandalone();
        },
      ),
    startService: () =>
      runOperation('Starting service…', 'Could not start the service', async () => {
        await service.start();
        if (await waitForService(30_000)) {
          setMode('client');
          loadMain(url);
        }
      }),
    stopService: () =>
      runOperation('Stopping service…', 'Could not stop the service', async () => {
        await service.stop();
        loadMain(
          messagePage('Service stopped', 'Start the service again from "Status & Service…".'),
        );
        setMode('error');
      }),
    resetAdmin,
    openMain: () => showMain(),
    openLogsFolder: () => {
      const dir = join(mode === 'client' ? machineDataDir() : dataDir, 'logs');
      void shell.openPath(existsSync(dir) ? dir : dirname(dir));
    },
  };

  registerIpc(controller);

  const trayHandle = createTray(
    trayIcon,
    {
      open: () => showMain(),
      openStatus,
      openTunnelAdmin: () => showMain('/admin/tunnel'),
      resetAdmin: () => void resetAdmin(),
      quit: () => {
        quitting = true;
        app.quit();
      },
      describe,
    },
    version,
  );

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
