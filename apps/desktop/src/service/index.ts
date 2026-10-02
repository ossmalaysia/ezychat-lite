// OS service manager: generates install/uninstall scripts and runs them elevated.
// No electron import (kept testable); the main process passes paths in via deps.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { exec as sudoExec } from 'sudo-prompt';
import {
  macControlScript,
  macInstallScript,
  macResetAdminScript,
  macUninstallScript,
  parseLaunchctlPrint,
  plistPath,
  shQuote,
} from './macos.js';
import {
  parseScQuery,
  psQuote,
  type ServiceState,
  windowsControlScript,
  windowsInstallScript,
  windowsResetAdminScript,
  windowsUninstallScript,
} from './windows.js';

export type { ServiceState };
export { DataMoveError, dataMoveCommands } from './data-move.js';

const BOM = '\uFEFF';

export const SERVICE_ID = 'wa-team-inbox';
export const SERVICE_NAME = 'WA Team Inbox Server';
export const LAUNCHD_LABEL = 'org.ossmalaysia.wateaminbox.server';

export interface ServiceManager {
  status(): Promise<ServiceState>;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  resetAdmin(): Promise<string>;
}

export interface ServiceDeps {
  /** process.execPath — the Electron binary, run with ELECTRON_RUN_AS_NODE=1 */
  execPath: string;
  serverEntry: string;
  webDist: string;
  /** full path to cloudflared(.exe) if bundled */
  cloudflaredBinary: string | null;
  cloudflaredDir: string;
  winswExe: string;
  userDataDir: string;
  machineDataDir: string;
  port: number;
  version: string;
  log?: (s: string) => void;
}

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(file: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const errCode = (err as { code?: unknown } | null)?.code;
      const code = err ? (typeof errCode === 'number' ? errCode : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** Server args/env used by the OS service. */
export function serviceCommand(d: ServiceDeps): { exe: string; args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: '1',
    WATI_VERSION: d.version,
    WATI_CLOUDFLARED_DIR: d.cloudflaredDir,
  };
  if (d.cloudflaredBinary && existsSync(d.cloudflaredBinary)) env.WATI_CLOUDFLARED = d.cloudflaredBinary;
  return {
    exe: d.execPath,
    args: [d.serverEntry, '--data', d.machineDataDir, '--port', String(d.port), '--mode', 'service', '--web-dist', d.webDist],
    env,
  };
}

/** Runs a PowerShell script elevated (UAC prompt); returns its combined output. */
async function runElevatedWindows(script: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'wati-svc-'));
  const inner = join(dir, 'task.ps1');
  const wrapper = join(dir, 'run.ps1');
  const log = join(dir, 'out.log');
  try {
    // BOM so Windows PowerShell 5 reads non-ASCII paths correctly
    writeFileSync(inner, BOM + script, 'utf8');
    writeFileSync(
      wrapper,
      BOM +
        [
          "$ErrorActionPreference = 'Stop'",
          'try {',
          `  & ${psQuote(inner)} *>&1 | Out-File -LiteralPath ${psQuote(log)} -Encoding utf8`,
          '  exit 0',
          '} catch {',
          `  ($_ | Out-String) | Out-File -LiteralPath ${psQuote(log)} -Append -Encoding utf8`,
          '  exit 1',
          '}',
        ].join('\r\n'),
      'utf8',
    );
    const argList = psQuote(`-NoProfile -ExecutionPolicy Bypass -File "${wrapper}"`);
    const r = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ${argList}; exit $p.ExitCode`,
    ]);
    const out = existsSync(log) ? readFileSync(log, 'utf8').replace(/^\uFEFF/, '').trim() : '';
    if (r.code !== 0) {
      const msg = out || r.stderr.trim() || 'Elevated command failed or was cancelled.';
      throw new Error(msg);
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs a bash script as root via the macOS admin prompt (sudo-prompt). */
async function runElevatedMac(script: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'wati-svc-'));
  const file = join(dir, 'task.sh');
  writeFileSync(file, script, { encoding: 'utf8', mode: 0o700 });
  try {
    return await new Promise<string>((resolve, reject) => {
      sudoExec(`/bin/bash ${shQuote(file)}`, { name: 'WA Team Inbox' }, (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr ?? '').trim() || err.message));
        else resolve(String(stdout ?? '').trim());
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function createServiceManager(platform: NodeJS.Platform, deps: ServiceDeps): ServiceManager {
  const log = deps.log ?? (() => {});
  if (platform === 'win32') {
    const serviceDir = `${deps.machineDataDir}\\service`;
    return {
      async status() {
        const r = await run('sc.exe', ['query', SERVICE_ID]);
        return parseScQuery(r.code, r.stdout + r.stderr);
      },
      async install() {
        const cmd = serviceCommand(deps);
        const script = windowsInstallScript({
          id: SERVICE_ID,
          name: SERVICE_NAME,
          exe: cmd.exe,
          args: cmd.args,
          env: cmd.env,
          logDir: `${serviceDir}\\logs`,
          winswSource: deps.winswExe,
          serviceDir,
          dataDir: deps.machineDataDir,
          moveFrom: deps.userDataDir,
          exists: existsSync,
        });
        log(await runElevatedWindows(script));
      },
      async uninstall() {
        log(
          await runElevatedWindows(
            windowsUninstallScript({ id: SERVICE_ID, serviceDir, dataDir: deps.machineDataDir, moveTo: deps.userDataDir }),
          ),
        );
      },
      async start() {
        log(await runElevatedWindows(windowsControlScript({ id: SERVICE_ID, serviceDir, action: 'start' })));
      },
      async stop() {
        log(await runElevatedWindows(windowsControlScript({ id: SERVICE_ID, serviceDir, action: 'stop' })));
      },
      async resetAdmin() {
        return runElevatedWindows(
          windowsResetAdminScript({ exe: deps.execPath, entry: deps.serverEntry, dataDir: deps.machineDataDir }),
        );
      },
    };
  }
  if (platform === 'darwin') {
    const logDir = `${deps.machineDataDir}/logs`;
    return {
      async status() {
        const r = await run('launchctl', ['print', `system/${LAUNCHD_LABEL}`]);
        return parseLaunchctlPrint(r.code, r.stdout + r.stderr, existsSync(plistPath(LAUNCHD_LABEL)));
      },
      async install() {
        const cmd = serviceCommand(deps);
        const script = macInstallScript({
          label: LAUNCHD_LABEL,
          program: cmd.exe,
          args: cmd.args,
          env: cmd.env,
          logDir,
          dataDir: deps.machineDataDir,
          moveFrom: deps.userDataDir,
          exists: existsSync,
        });
        log(await runElevatedMac(script));
      },
      async uninstall() {
        log(
          await runElevatedMac(
            macUninstallScript({
              label: LAUNCHD_LABEL,
              dataDir: deps.machineDataDir,
              moveTo: deps.userDataDir,
              owner: userInfo().username,
            }),
          ),
        );
      },
      async start() {
        log(await runElevatedMac(macControlScript({ label: LAUNCHD_LABEL, action: 'start' })));
      },
      async stop() {
        log(await runElevatedMac(macControlScript({ label: LAUNCHD_LABEL, action: 'stop' })));
      },
      async resetAdmin() {
        return runElevatedMac(macResetAdminScript({ exe: deps.execPath, entry: deps.serverEntry, dataDir: deps.machineDataDir }));
      },
    };
  }
  const unsupported = async (): Promise<never> => {
    throw new Error(`Service mode is not supported on ${platform}`);
  };
  return {
    status: async () => 'not-installed',
    install: unsupported,
    uninstall: unsupported,
    start: unsupported,
    stop: unsupported,
    resetAdmin: unsupported,
  };
}
