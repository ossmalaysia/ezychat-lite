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
import { uptime } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appTitle } from './app-title.js';
import { probeServer } from './detect.js';
import { desktopIntlTag, desktopLocale, statusStrings, t } from './i18n.js';
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
  mergeDesktopConfig,
  parseDesktopConfig,
  type DesktopConfig,
  preserveInstalledProfile,
  serverEntry,
  serverHost,
  servicePortFile,
  serviceRunDir,
  standalonePortFile,
  trayIconFile,
  userDataDir,
  webDistDir,
  winswExe,
} from './paths.js';
import { runServerCommand, StandaloneServer } from './server-process.js';
import { createServiceOperation } from './service-operation.js';
import { watchForService } from './service-recovery.js';
import { decideStartup, parsePortFile, serviceWaitMs } from './startup.js';
import { createServiceManager, type ServiceManager, type ServiceState } from './service/index.js';
import { createTray } from './tray.js';
import { closeAction } from './window-close.js';
import { GitHubUpdateChecker } from './update-checker.js';
import { isUpdateHost, registerUpdateIpc } from './update-ipc.js';
import { ManagedUpdates } from './updater/controller.js';
import { downloadRelease, verifyDownloadedRelease } from './updater/download.js';
import {
  prepareUpdateInstall,
  readUpdateInstallResult,
  updateInstallEligibility,
  type InstallContext,
} from './updater/install.js';
import {
  clearWebCacheOnVersionChange,
  createMainWindow,
  createStatusWindow,
  messagePage,
} from './window.js';

const here = dirname(fileURLToPath(import.meta.url));

// Electron's default profile follows productName; pin the installed profile before its lock.
preserveInstalledProfile(app, (path) => mkdirSync(path, { recursive: true }));
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('org.ossmalaysia.wateaminbox');
  void main();
}

function desktopConfigFile(): string {
  return join(app.getPath('userData'), 'desktop.json');
}

function readDesktopConfig(): DesktopConfig {
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

/** Merges a change into desktop.json (a malformed file is replaced); throws when it cannot be saved. */
function writeDesktopConfig(patch: Partial<DesktopConfig>): void {
  const file = desktopConfigFile();
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, mergeDesktopConfig(raw, patch));
}

/** Remembers the port the server actually uses (e.g. after a port change in Admin > Settings). */
function writeDesktopPort(port: number): void {
  try {
    writeDesktopConfig({ port });
  } catch {
    // best effort: the next start falls back to the configured or default port
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
  const desktopConfig = readDesktopConfig();
  let port = desktopConfig.port;
  let keepInTray = desktopConfig.keepInTray;
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
  // The desktop shell follows the OS language of this machine (not a web user's setting).
  const locale = desktopLocale(app);
  const page = (title: string, body: string) => messagePage(title, body, locale);
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

  const appIconFile = isPackaged
    ? join(resourcesPath, 'app-icon.png')
    : join(appPath, 'build', 'icon.png');
  const exportedIcon = nativeImage.createFromPath(appIconFile);
  const appIcon: NativeImage = exportedIcon.isEmpty()
    ? nativeImage.createFromPath(trayIconFile(isPackaged, resourcesPath, appPath, 'win32'))
    : exportedIcon;
  // Use checked-in brand exports for both window and tray; fall back to the window mark.
  const trayIcon: NativeImage = (() => {
    const mac = process.platform === 'darwin';
    const file = trayIconFile(isPackaged, resourcesPath, appPath);
    let img = existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
    if (img.isEmpty()) {
      log(`tray icon not found at ${file}; using app icon`);
      img = appIcon.resize({ width: 32, height: 32 });
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
  const statusFile = join(appPath, 'src', 'renderer', 'status.html');
  const ownsHost = () => !quitting && isUpdateHost(mode, lastServiceState);
  let updateChanged = () => {};
  const checker = new GitHubUpdateChecker({
    currentVersion: version,
    platform: process.platform,
    arch: process.arch,
    isHost: ownsHost,
    onChanged: () => updateChanged(),
    log: (fields) => log(JSON.stringify({ mod: 'desktop-updates', ...fields })),
    locale,
  });
  const installContext = (): InstallContext => ({
    platform: process.platform === 'darwin' ? 'darwin' : 'win32',
    execPath: process.execPath,
    appBundle,
    userDataDir: app.getPath('userData'),
    machineDataDir: machineDataDir(),
    serviceRunDir: serviceRunDir(),
    serviceInstalled: lastServiceState !== 'not-installed',
    oldPid: process.pid,
  });
  const eligibility =
    isPackaged && serviceSupported
      ? updateInstallEligibility(installContext())
      : {
          eligible: false,
          reason: t(locale, 'updates.installUnsupported'),
        };
  const lastInstall = await readUpdateInstallResult(app.getPath('userData')).catch(
    (error: unknown) => {
      log(
        JSON.stringify({
          mod: 'desktop-updates',
          event: 'result_read_failed',
          error: String(error),
        }),
      );
      return null;
    },
  );
  const updates = new ManagedUpdates({
    checker,
    canInstall: () => ownsHost() && eligibility.eligible,
    unavailableReason: eligibility.reason ?? t(locale, 'updates.hostOnly'),
    lastInstall,
    download: (release, signal, onProgress) =>
      downloadRelease(release, {
        directory: join(app.getPath('userData'), 'updates', 'downloads'),
        signal,
        onProgress,
      }),
    verify: verifyDownloadedRelease,
    install: async (artifact) => {
      if (busy || quitting) throw new Error(t(locale, 'updates.waitForOperation'));
      let failure: unknown;
      await runOperation(
        t(locale, 'updates.preparing'),
        t(locale, 'updates.installFailed'),
        async () => {
          try {
            // Refresh the actual service state while holding the same gate as install/remove/reset.
            await currentServiceState();
            if (!ownsHost()) throw new Error(t(locale, 'updates.hostGone'));
            const prepared = await prepareUpdateInstall({
              artifact,
              context: installContext(),
              // install.ts reports a single English progress message: show it translated.
              onProgress: () => setBusy(t(locale, 'updates.approvePrompt')),
            });
            try {
              if (quitting) throw new Error(t(locale, 'updates.closedBeforeConfirm'));
              setBusy(t(locale, 'updates.restarting'));
              await server.stop();
              // The external helper acknowledges handoff before this process releases its app files.
              await prepared.commit();
              quitting = true;
              app.quit();
            } catch (error) {
              await prepared.cancel().catch((cancelError: unknown) => {
                log(
                  JSON.stringify({
                    mod: 'desktop-updates',
                    event: 'cancel_failed',
                    error: String(cancelError),
                  }),
                );
              });
              throw error;
            }
          } catch (error) {
            failure = error;
            throw error;
          }
        },
        async () => {
          if (!quitting) await connectOrStart();
        },
      );
      if (failure) throw failure;
    },
    onChanged: () => updateChanged(),
    log: (fields) => log(JSON.stringify(fields)),
  });
  const syncUpdates = () => {
    if (quitting || !ownsHost()) updates.stop();
    else updates.start();
    updateChanged();
  };

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
    broadcastStatusChanged(statusWindow, statusFile);
  });

  /** Switches to the port the server actually listens on (persisted port setting). */
  const adoptPort = (p: number) => {
    if (p === port) return;
    log(`[desktop] server port is now ${p} (was ${port})`);
    port = p;
    url = `http://127.0.0.1:${port}`;
    writeDesktopPort(port);
    broadcastStatusChanged(statusWindow, statusFile);
  };
  server.on('port', (p: number) => adoptPort(p));
  const adoptServicePort = () => {
    const p = readPortFile(servicePortFile());
    if (p !== null) adoptPort(p);
  };

  /**
   * Polls for the OS service (re-reading its port file) until it answers, the deadline passes, or
   * `keepWaiting` turns false (something else took over the window).
   */
  const waitForService = async (
    timeoutMs: number,
    keepWaiting: () => boolean = () => true,
  ): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && keepWaiting()) {
      adoptServicePort();
      if (await probeServer(port)) return true;
      await new Promise((r) => setTimeout(r, 750));
    }
    return false;
  };

  let stopRecovery = () => {};
  const serviceDown = (state: ServiceState) => {
    setMode('error');
    loadMain(
      page(
        state === 'running'
          ? t(locale, 'page.serviceNotAnsweringTitle')
          : t(locale, 'page.serviceNotRunningTitle'),
        t(locale, 'page.serviceDownBody'),
      ),
    );
    // The service may still come up (late auto-start, or started from Windows): keep checking
    // and open the inbox as soon as it answers, instead of leaving the error page up for good.
    stopRecovery();
    stopRecovery = watchForService({
      probe: async () => {
        adoptServicePort();
        return (await probeServer(port)) !== null;
      },
      isActive: () => mode === 'error',
      canSwitch: () => mode === 'error' && !busy,
      onAnswer: () => {
        log(`[desktop] background service answered on port ${port}; connecting`);
        setMode('client');
        loadMain(url);
      },
    });
  };

  const describe = (): string => {
    if (busy) return busy;
    if (mode === 'client') return t(locale, 'mode.client');
    if (mode === 'standalone')
      return t(locale, 'mode.standalone', { state: t(locale, `serverState.${server.state}`) });
    if (mode === 'error') return t(locale, 'mode.error');
    return t(locale, 'mode.starting');
  };

  const setMode = (m: DesktopMode) => {
    if (m !== 'error') stopRecovery();
    mode = m;
    syncUpdates();
    trayHandle.refresh();
    broadcastStatusChanged(statusWindow, statusFile);
  };
  const setBusy = (b: string | null) => {
    busy = b;
    trayHandle.refresh();
    broadcastStatusChanged(statusWindow, statusFile);
  };

  const showMain = (path = '/') => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow({
        icon: appIcon,
        baseUrl: () => url,
        title: appTitle(version, { devBuild: !isPackaged }),
        preload: join(here, 'inbox-preload.cjs'),
      });
      mainWindow.on('close', (e) => {
        if (quitting) return;
        if (closeAction(mode, keepInTray) === 'quit') {
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
          page(t(locale, 'page.startingTitle'), t(locale, 'page.startingBody')),
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
      html: statusFile,
      title: appTitle(version, { devBuild: !isPackaged }),
      locale,
    });
    statusWindow.on('closed', () => (statusWindow = null));
  };

  const errorBox = (title: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[desktop] ${title}: ${msg}`);
    void dialog.showMessageBox({
      type: 'error',
      title: 'EzyChat Lite',
      message: title,
      detail: msg,
    });
  };
  const runOperation = createServiceOperation(setBusy, errorBox);

  const startStandalone = async (): Promise<boolean> => {
    setMode('starting');
    loadMain(page(t(locale, 'page.startingTitle'), t(locale, 'page.startingBody')));
    server.start();
    const ok = await server.waitRunning(45_000);
    adoptPort(server.port);
    if (ok) {
      setMode('standalone');
      loadMain(url);
      return true;
    }
    setMode('error');
    loadMain(page(t(locale, 'page.notStartedTitle'), t(locale, 'page.notStartedBody', { port })));
    return false;
  };

  const currentServiceState = async (): Promise<ServiceState> => {
    if (!serviceSupported) return 'not-installed';
    try {
      lastServiceState = await service.status();
    } catch {
      // keep last
    }
    syncUpdates();
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
      const waitMs = serviceWaitMs(svc, uptime());
      if (waitMs > 0) {
        setMode('starting');
        loadMain(page(t(locale, 'page.connectingTitle'), t(locale, 'page.connectingBody')));
        // A user operation (e.g. removing the service) may take over during the wait: stop
        // waiting then, and never switch a window that now hosts its own server to client mode.
        const undisturbed = () => mode === 'starting' && !busy;
        const answered = await waitForService(waitMs, undisturbed);
        if (!undisturbed()) return; // the operation owns the window now
        if (answered) {
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
    runOperation(t(locale, 'reset.busyConfirm'), t(locale, 'reset.failed'), async () => {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: t(locale, 'reset.confirmTitle'),
        message: t(locale, 'reset.confirmMessage'),
        detail: t(locale, 'reset.confirmDetail'),
        buttons: [t(locale, 'reset.confirmButton'), t(locale, 'common.cancel')],
        defaultId: 1,
        cancelId: 1,
      });
      if (response !== 0) return;
      setBusy(t(locale, 'reset.busy'));
      let output: string;
      if (mode === 'client') {
        const st = await service.status();
        if (st === 'not-installed') throw new Error(t(locale, 'reset.notManaged'));
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
        if (r.code !== 0)
          throw new Error(output || t(locale, 'reset.exitCode', { code: String(r.code) }));
      }
      const m = /password for (.+?): (\S+)/.exec(output);
      const { response: r2 } = await dialog.showMessageBox({
        type: 'info',
        title: t(locale, 'reset.doneTitle'),
        message: m
          ? t(locale, 'reset.doneMessage', { user: m[1] ?? '' })
          : t(locale, 'reset.doneTitle'),
        detail: m ? t(locale, 'reset.doneDetail', { password: m[2] ?? '' }) : output,
        buttons: m
          ? [t(locale, 'reset.copy'), t(locale, 'common.close')]
          : [t(locale, 'common.close')],
        defaultId: 0,
      });
      if (m && r2 === 0) clipboard.writeText(m[2] ?? '');
    });

  const controller: DesktopController = {
    async getStatus(): Promise<DesktopStatus> {
      await currentServiceState();
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
        keepInTray,
        locale,
        intlTag: desktopIntlTag(locale),
        strings: statusStrings(locale),
      };
    },
    enableService: () =>
      runOperation(
        t(locale, 'service.enableBusyConfirm'),
        t(locale, 'service.enableFailed'),
        async () => {
          const { response } = await dialog.showMessageBox({
            type: 'question',
            title: t(locale, 'service.enableTitle'),
            message: t(locale, 'service.enableMessage'),
            detail: t(locale, 'service.enableDetail', { folder: machineDataDir() }),
            buttons: [t(locale, 'service.enableButton'), t(locale, 'common.cancel')],
            defaultId: 0,
            cancelId: 1,
          });
          if (response !== 0) return;
          setBusy(t(locale, 'service.installing'));
          await server.stop();
          await service.install();
          await currentServiceState();
          setBusy(t(locale, 'service.waiting'));
          const ok = await waitForService(60_000);
          if (!ok) throw new Error(t(locale, 'service.noAnswer', { port }));
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
        t(locale, 'service.disableBusyConfirm'),
        t(locale, 'service.disableFailed'),
        async () => {
          const { response } = await dialog.showMessageBox({
            type: 'question',
            title: t(locale, 'service.disableTitle'),
            message: t(locale, 'service.disableMessage'),
            detail: t(locale, 'service.disableDetail'),
            buttons: [t(locale, 'service.disableButton'), t(locale, 'common.cancel')],
            defaultId: 0,
            cancelId: 1,
          });
          if (response !== 0) return;
          setBusy(t(locale, 'service.removing'));
          await service.uninstall();
          await currentServiceState();
          setBusy(t(locale, 'service.startingLocal'));
          await startStandalone();
        },
      ),
    startService: () =>
      runOperation(t(locale, 'service.starting'), t(locale, 'service.startFailed'), async () => {
        await service.start();
        if (await waitForService(30_000)) {
          setMode('client');
          loadMain(url);
        }
      }),
    stopService: () =>
      runOperation(t(locale, 'service.stopping'), t(locale, 'service.stopFailed'), async () => {
        await service.stop();
        loadMain(page(t(locale, 'page.serviceStoppedTitle'), t(locale, 'page.serviceStoppedBody')));
        setMode('error');
      }),
    resetAdmin,
    openMain: () => showMain(),
    openLogsFolder: () => {
      const dir = join(mode === 'client' ? machineDataDir() : dataDir, 'logs');
      void shell.openPath(existsSync(dir) ? dir : dirname(dir));
    },
    setKeepInTray: (keep) => {
      // Persist first: a failed save throws to the status page, which then shows the unchanged value.
      try {
        writeDesktopConfig({ keepInTray: keep });
      } catch (err) {
        log(`could not save the tray preference: ${(err as Error).message}`);
        throw new Error(t(locale, 'common.trayPrefFailed'), { cause: err });
      }
      keepInTray = keep;
      log(`keep in tray: ${keep}`);
    },
  };

  const statusIpc = registerIpc(controller, () => statusWindow, statusFile);
  const updateIpc = registerUpdateIpc(updates, {
    main: () => mainWindow,
    status: () => statusWindow,
    baseUrl: () => url,
    statusFile,
  });

  const trayHandle = createTray(
    trayIcon,
    {
      open: () => showMain(),
      openStatus,
      openTunnelAdmin: () => showMain('/admin/tunnel'),
      resetAdmin: () => void resetAdmin(),
      checkUpdates: () => {
        openStatus();
        void updates.check();
      },
      updateLabel: () => {
        if (!ownsHost()) return null;
        const state = updates.getState();
        if (state.transfer?.status === 'ready')
          return t(locale, 'updates.trayRestart', { version: state.transfer.version ?? '' });
        if (state.transfer?.status === 'downloading') return t(locale, 'updates.trayDownloading');
        return state.release
          ? t(locale, 'updates.trayAvailable', { version: state.release.version })
          : t(locale, 'updates.trayCheck');
      },
      quit: () => {
        quitting = true;
        app.quit();
      },
      describe,
    },
    version,
    locale,
  );
  updateChanged = () => {
    trayHandle.refresh();
    updateIpc.broadcast(updates.getState());
  };

  app.on('second-instance', () => showMain());
  app.on('activate', () => showMain());
  app.on('window-all-closed', () => {
    // keep running in the tray (standalone)
  });
  let finalStopDone = false;
  app.on('before-quit', (e) => {
    quitting = true;
    updates.stop();
    updateIpc.dispose();
    statusIpc.dispose();
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
