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
    `  <description>${xmlEscape(o.name)} - shared team inbox server (EzyChat Lite)</description>`,
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
  /** sub-folder of dataDir that local users may read (port file); optional */
  runDir?: string;
  exists?: ((p: string) => boolean) | null;
}

const SID_SYSTEM = 'S-1-5-18';
const SID_ADMINS = 'S-1-5-32-544';
const SID_USERS = 'S-1-5-32-545';

/**
 * Locks `dir` down to SYSTEM + Administrators: Administrators become owner of the whole tree
 * (a standard user who pre-created the folder would otherwise keep implicit WRITE_DAC), the top
 * folder gets explicit SYSTEM/Administrators full control without inheritance, and every child
 * is reset to inherit only that (drops explicit ACEs carried in with moved user files).
 */
function lockDownLines(dir: string): string[] {
  const d = psQuote(dir);
  return [
    `icacls ${d} /setowner '*${SID_ADMINS}' /T /C /Q | Out-Null`,
    checkExit('icacls /setowner'),
    `icacls ${d} /inheritance:r /grant:r '*${SID_SYSTEM}:(OI)(CI)F' '*${SID_ADMINS}:(OI)(CI)F' /C /Q | Out-Null`,
    checkExit('icacls /grant'),
    `Get-ChildItem -LiteralPath ${d} -Force | ForEach-Object {`,
    `  icacls $_.FullName /reset /T /C /Q | Out-Null`,
    `  ${checkExit('icacls /reset')}`,
    `}`,
  ];
}

/** PowerShell helpers: owner/ACL verification. */
const PS_HELPERS = [
  `$allowedSids = @('${SID_SYSTEM}', '${SID_ADMINS}')`,
  `$sidType = [System.Security.Principal.SecurityIdentifier]`,
  `$writeRights = [System.Security.AccessControl.FileSystemRights]'Write, Delete, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership'`,
  `function Get-OwnerSid([string]$p) { (Get-Acl -LiteralPath $p).GetOwner($sidType).Value }`,
  `function Test-UntrustedDir([string]$p) {`,
  `  $item = Get-Item -LiteralPath $p -Force`,
  `  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { return $true }`,
  `  return ($allowedSids -notcontains (Get-OwnerSid $p))`,
  `}`,
  `# Throws unless $p (and, with -Recurse, everything below it) is owned by SYSTEM/Administrators and`,
  `# grants write-type rights to nobody else. $readers may hold non-write rights (e.g. Users RX).`,
  `function Assert-Locked([string]$p, [string[]]$readers = @(), [switch]$Recurse) {`,
  `  $items = @(Get-Item -LiteralPath $p -Force)`,
  `  if ($Recurse) { $items += @(Get-ChildItem -LiteralPath $p -Force -Recurse) }`,
  `  foreach ($it in $items) {`,
  `    if ($it.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Unexpected link: $($it.FullName)" }`,
  `    $acl = Get-Acl -LiteralPath $it.FullName`,
  `    $owner = $acl.GetOwner($sidType).Value`,
  `    if ($allowedSids -notcontains $owner) { throw "Unexpected owner $owner on $($it.FullName)" }`,
  `    foreach ($ace in $acl.GetAccessRules($true, $true, $sidType)) {`,
  `      if ($ace.AccessControlType -ne 'Allow') { continue }`,
  `      $sid = $ace.IdentityReference.Value`,
  `      if ($allowedSids -contains $sid) { continue }`,
  `      if (($readers -contains $sid) -and -not ($ace.FileSystemRights -band $writeRights)) { continue }`,
  `      throw "Unexpected access for $sid on $($it.FullName)"`,
  `    }`,
  `  }`,
  `}`,
];

/**
 * PowerShell script (run elevated): secure the machine data dir, copy WinSW + xml into a fresh
 * service dir, move data, lock down + verify owner/ACL, install + start.
 */
export function windowsInstallScript(o: WindowsInstallOptions): string {
  const exe = `${o.serviceDir}\\${o.id}.exe`;
  const xml = `${o.serviceDir}\\${o.id}.xml`;
  const d = psQuote(o.dataDir);
  const lines = [
    ...PS_HEADER,
    ...PS_HELPERS,
    // 1. C:\ProgramData lets standard users create sub-folders: a folder that already exists
    //    must be ours (SYSTEM/Administrators-owned, not a link) — otherwise move it aside.
    `if (Test-Path -LiteralPath ${d}) {`,
    `  if (Test-UntrustedDir ${d}) {`,
    `    $aside = ${d} + '.untrusted-' + (Get-Date -Format 'yyyyMMddHHmmss')`,
    `    Move-Item -LiteralPath ${d} -Destination $aside`,
    `    Write-Output "Moved untrusted pre-existing folder to $aside"`,
    `  }`,
    `}`,
    `New-Item -ItemType Directory -Force -Path ${d} | Out-Null`,
    ...lockDownLines(o.dataDir),
    // 2. fresh service dir: nothing planted next to the wrapper survives (rmdir does not follow links)
    `if (Test-Path -LiteralPath ${psQuote(o.serviceDir)}) {`,
    `  & cmd.exe /d /c rmdir /s /q ${psQuote(o.serviceDir)}`,
    `  if (Test-Path -LiteralPath ${psQuote(o.serviceDir)}) { throw 'Could not remove the old service folder (is the service still running?)' }`,
    `}`,
    `New-Item -ItemType Directory -Force -Path ${psQuote(o.serviceDir)} | Out-Null`,
    `New-Item -ItemType Directory -Force -Path ${psQuote(o.logDir)} | Out-Null`,
    `Copy-Item -LiteralPath ${psQuote(o.winswSource)} -Destination ${psQuote(exe)} -Force`,
    `$xml = @'`,
    winswXml(o).trimEnd(),
    `'@`,
    `[System.IO.File]::WriteAllText(${psQuote(xml)}, $xml, (New-Object System.Text.UTF8Encoding $false))`,
    ...dataMoveCommands('win32', o.moveFrom, o.dataDir, o.exists === undefined ? null : o.exists),
    `New-Item -ItemType Directory -Force -Path ${d} | Out-Null`,
    // 3. SYSTEM (S-1-5-18) + Administrators (S-1-5-32-544) only, including moved-in files
    ...lockDownLines(o.dataDir),
    ...(o.runDir
      ? [
          `New-Item -ItemType Directory -Force -Path ${psQuote(o.runDir)} | Out-Null`,
          // local users may read the port file the service writes here (not write)
          `icacls ${psQuote(o.runDir)} /grant '*${SID_USERS}:(OI)(CI)RX' /C /Q | Out-Null`,
          checkExit('icacls run dir'),
        ]
      : []),
    // 4. verify before handing the folder to a LocalSystem service
    `Assert-Locked ${d}`,
    `Assert-Locked ${psQuote(o.serviceDir)} -Recurse`,
    ...(o.runDir ? [`Assert-Locked ${psQuote(o.runDir)} -readers @('${SID_USERS}')`] : []),
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
  /** run dir (port file) to drop before moving the data back */
  runDir?: string;
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
    ...(o.runDir
      ? [
          `if (Test-Path -LiteralPath ${psQuote(o.runDir)}) { Remove-Item -LiteralPath ${psQuote(o.runDir)} -Recurse -Force }`,
        ]
      : []),
    ...dataMoveCommands('win32', o.dataDir, o.moveTo, null),
    `if (Test-Path -LiteralPath ${psQuote(o.moveTo)}) {`,
    `  icacls ${psQuote(o.moveTo)} /reset /T /C /Q | Out-Null`,
    `}`,
    `Write-Output 'Service removed.'`,
  ];
  return lines.join('\r\n') + '\r\n';
}

export function windowsControlScript(o: {
  id: string;
  serviceDir: string;
  action: 'start' | 'stop';
}): string {
  const exe = `${o.serviceDir}\\${o.id}.exe`;
  return (
    [...PS_HEADER, `& ${psQuote(exe)} ${o.action}`, checkExit(`service ${o.action}`)].join('\r\n') +
    '\r\n'
  );
}

/** Elevated reset-admin: runs the server entry with --reset-admin against the machine data dir. */
export function windowsResetAdminScript(o: {
  exe: string;
  entry: string;
  dataDir: string;
}): string {
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
