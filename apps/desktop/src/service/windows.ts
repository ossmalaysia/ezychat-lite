// Windows service (WinSW) builders. Pure string builders — no electron import (unit tested).
import { dataMoveCommands } from './data-move.js';

export interface WinswOptions {
  id: string;
  name: string;
  exe: string;
  args: string[];
  env: Record<string, string>;
  logDir: string;
}

export type ServiceState = 'not-installed' | 'stopped' | 'running';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Quotes one argument for a Windows command line (CommandLineToArgvW rules). */
export function quoteWinArg(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
    } else if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      out += '\\'.repeat(backslashes) + ch;
      backslashes = 0;
    }
  }
  out += '\\'.repeat(backslashes * 2) + '"';
  return out;
}

/** PowerShell single-quoted literal. */
export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** WinSW v2 service configuration. Runs as LocalSystem (WinSW default). */
export function winswXml(o: WinswOptions): string {
  const env = Object.entries(o.env)
    .map(([k, v]) => `  <env name="${xmlEscape(k)}" value="${xmlEscape(v)}"/>`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<service>',
    `  <id>${xmlEscape(o.id)}</id>`,
    `  <name>${xmlEscape(o.name)}</name>`,
    `  <description>${xmlEscape(o.name)} - shared team inbox server (WA Team Inbox)</description>`,
    `  <executable>${xmlEscape(o.exe)}</executable>`,
    `  <arguments>${xmlEscape(o.args.map(quoteWinArg).join(' '))}</arguments>`,
    env,
    '  <startmode>Automatic</startmode>',
    '  <delayedAutoStart>false</delayedAutoStart>',
    '  <onfailure action="restart" delay="5 sec"/>',
    '  <onfailure action="restart" delay="10 sec"/>',
    '  <onfailure action="restart" delay="30 sec"/>',
    '  <resetfailure>1 hour</resetfailure>',
    '  <stoptimeout>15 sec</stoptimeout>',
    `  <logpath>${xmlEscape(o.logDir)}</logpath>`,
    '  <log mode="roll-by-size">',
    '    <sizeThreshold>10240</sizeThreshold>',
    '    <keepFiles>8</keepFiles>',
    '  </log>',
    '</service>',
    '',
  ].join('\n');
}

const PS_HEADER = ["$ErrorActionPreference = 'Stop'", "$ProgressPreference = 'SilentlyContinue'"];

function checkExit(what: string): string {
  return `if ($LASTEXITCODE -ne 0) { throw "${what} failed with exit code $LASTEXITCODE" }`;
}

export interface WindowsInstallOptions extends WinswOptions {
  /** bundled WinSW-x64.exe */
  winswSource: string;
  /** machine dir holding <id>.exe + <id>.xml */
  serviceDir: string;
  /** machine data dir (passed to the server as --data) */
  dataDir: string;
  /** user data dir to move into dataDir (skipped when missing) */
  moveFrom: string;
  exists?: ((p: string) => boolean) | null;
}

/** PowerShell script (run elevated): copy WinSW + xml, move data, lock down ACL, install + start. */
export function windowsInstallScript(o: WindowsInstallOptions): string {
  const exe = `${o.serviceDir}\\${o.id}.exe`;
  const xml = `${o.serviceDir}\\${o.id}.xml`;
  const lines = [
    ...PS_HEADER,
    `New-Item -ItemType Directory -Force -Path ${psQuote(o.serviceDir)} | Out-Null`,
    `New-Item -ItemType Directory -Force -Path ${psQuote(o.logDir)} | Out-Null`,
    `Copy-Item -LiteralPath ${psQuote(o.winswSource)} -Destination ${psQuote(exe)} -Force`,
    `$xml = @'`,
    winswXml(o).trimEnd(),
    `'@`,
    `[System.IO.File]::WriteAllText(${psQuote(xml)}, $xml, (New-Object System.Text.UTF8Encoding $false))`,
    ...dataMoveCommands('win32', o.moveFrom, o.dataDir, o.exists === undefined ? null : o.exists),
    `New-Item -ItemType Directory -Force -Path ${psQuote(o.dataDir)} | Out-Null`,
    // SYSTEM (S-1-5-18) + Administrators (S-1-5-32-544) only
    `icacls ${psQuote(o.dataDir)} /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /T /C /Q | Out-Null`,
    checkExit('icacls'),
    `& ${psQuote(exe)} install`,
    checkExit('service install'),
    `& ${psQuote(exe)} start`,
    checkExit('service start'),
    `Write-Output 'Service installed and started.'`,
  ];
  return lines.join('\r\n') + '\r\n';
}

export interface WindowsUninstallOptions {
  id: string;
  serviceDir: string;
  dataDir: string;
  /** user data dir to move the data back into */
  moveTo: string;
}

/** PowerShell script (run elevated): stop + uninstall service, remove wrapper, move data back, reset ACL. */
export function windowsUninstallScript(o: WindowsUninstallOptions): string {
  const exe = `${o.serviceDir}\\${o.id}.exe`;
  const lines = [
    ...PS_HEADER,
    `if (Test-Path -LiteralPath ${psQuote(exe)}) {`,
    `  & ${psQuote(exe)} stop`,
    `  Start-Sleep -Seconds 2`,
    `  & ${psQuote(exe)} uninstall`,
    `  ${checkExit('service uninstall')}`,
    `}`,
    `if (Test-Path -LiteralPath ${psQuote(o.serviceDir)}) { Remove-Item -LiteralPath ${psQuote(o.serviceDir)} -Recurse -Force }`,
    ...dataMoveCommands('win32', o.dataDir, o.moveTo, null),
    `if (Test-Path -LiteralPath ${psQuote(o.moveTo)}) {`,
    `  icacls ${psQuote(o.moveTo)} /reset /T /C /Q | Out-Null`,
    `}`,
    `Write-Output 'Service removed.'`,
  ];
  return lines.join('\r\n') + '\r\n';
}

export function windowsControlScript(o: { id: string; serviceDir: string; action: 'start' | 'stop' }): string {
  const exe = `${o.serviceDir}\\${o.id}.exe`;
  return [...PS_HEADER, `& ${psQuote(exe)} ${o.action}`, checkExit(`service ${o.action}`)].join('\r\n') + '\r\n';
}

/** Elevated reset-admin: runs the server entry with --reset-admin against the machine data dir. */
export function windowsResetAdminScript(o: { exe: string; entry: string; dataDir: string }): string {
  return (
    [
      ...PS_HEADER,
      `$env:ELECTRON_RUN_AS_NODE = '1'`,
      `& ${psQuote(o.exe)} ${psQuote(o.entry)} --data ${psQuote(o.dataDir)} --reset-admin`,
      checkExit('reset admin'),
    ].join('\r\n') + '\r\n'
  );
}

/** Interprets `sc.exe query <id>` output. */
export function parseScQuery(exitCode: number, output: string): ServiceState {
  if (exitCode === 1060 || /\b1060\b/.test(output)) return 'not-installed';
  if (/STATE\s*:\s*\d+\s+RUNNING/i.test(output) || /START_PENDING/i.test(output)) return 'running';
  if (/STATE\s*:/i.test(output)) return 'stopped';
  return exitCode === 0 ? 'stopped' : 'not-installed';
}
