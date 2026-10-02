// macOS LaunchDaemon builders. Pure string builders — no electron import (unit tested).
import { posix } from 'node:path';
import { dataMoveCommands } from './data-move.js';
import type { ServiceState } from './windows.js';

export interface LaunchdOptions {
  label: string;
  program: string;
  args: string[];
  env: Record<string, string>;
  logDir: string;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** POSIX shell single-quoted literal. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function plistPath(label: string): string {
  return `/Library/LaunchDaemons/${label}.plist`;
}

export function launchdPlist(o: LaunchdOptions): string {
  const s = (v: string) => `<string>${xmlEscape(v)}</string>`;
  const args = [o.program, ...o.args].map((a) => `    ${s(a)}`).join('\n');
  const env = Object.entries(o.env)
    .map(([k, v]) => `    <key>${xmlEscape(k)}</key>\n    ${s(v)}`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  ${s(o.label)}`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    args,
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    env,
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>ThrottleInterval</key>',
    '  <integer>5</integer>',
    '  <key>StandardOutPath</key>',
    `  ${s(posix.join(o.logDir, 'service.out.log'))}`,
    '  <key>StandardErrorPath</key>',
    `  ${s(posix.join(o.logDir, 'service.err.log'))}`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export interface MacInstallOptions extends LaunchdOptions {
  dataDir: string;
  moveFrom: string;
  exists?: ((p: string) => boolean) | null;
}

/** sh script (run as root): move data, lock down data dir, write plist, bootstrap the daemon. */
export function macInstallScript(o: MacInstallOptions): string {
  const plist = plistPath(o.label);
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    ...dataMoveCommands('darwin', o.moveFrom, o.dataDir, o.exists === undefined ? null : o.exists),
    `mkdir -p ${shQuote(o.dataDir)} ${shQuote(o.logDir)}`,
    `chown -R root:wheel ${shQuote(o.dataDir)}`,
    `chmod 700 ${shQuote(o.dataDir)}`,
    `cat > ${shQuote(plist)} <<'WATI_PLIST_EOF'`,
    launchdPlist(o).trimEnd(),
    'WATI_PLIST_EOF',
    `chown root:wheel ${shQuote(plist)}`,
    `chmod 644 ${shQuote(plist)}`,
    `launchctl bootout system/${o.label} 2>/dev/null || true`,
    `launchctl bootstrap system ${shQuote(plist)}`,
    `echo 'Service installed and started.'`,
    '',
  ].join('\n');
}

export interface MacUninstallOptions {
  label: string;
  dataDir: string;
  moveTo: string;
  /** local user who owns the moved-back data */
  owner: string;
}

export function macUninstallScript(o: MacUninstallOptions): string {
  const plist = plistPath(o.label);
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    `launchctl bootout system/${o.label} 2>/dev/null || true`,
    `rm -f ${shQuote(plist)}`,
    ...dataMoveCommands('darwin', o.dataDir, o.moveTo, null),
    `if [ -d ${shQuote(o.moveTo)} ]; then chown -R ${shQuote(o.owner)} ${shQuote(o.moveTo)}; fi`,
    `echo 'Service removed.'`,
    '',
  ].join('\n');
}

export function macControlScript(o: { label: string; action: 'start' | 'stop' }): string {
  const plist = plistPath(o.label);
  const body =
    o.action === 'start'
      ? [
          `if launchctl print system/${o.label} >/dev/null 2>&1; then`,
          `  launchctl kickstart -k system/${o.label}`,
          'else',
          `  launchctl bootstrap system ${shQuote(plist)}`,
          'fi',
        ]
      : [`launchctl bootout system/${o.label} 2>/dev/null || true`];
  return ['#!/bin/bash', 'set -euo pipefail', ...body, ''].join('\n');
}

export function macResetAdminScript(o: { exe: string; entry: string; dataDir: string }): string {
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    `ELECTRON_RUN_AS_NODE=1 ${shQuote(o.exe)} ${shQuote(o.entry)} --data ${shQuote(o.dataDir)} --reset-admin`,
    '',
  ].join('\n');
}

/** Interprets `launchctl print system/<label>` (exit code + output) plus whether the plist exists. */
export function parseLaunchctlPrint(exitCode: number, output: string, plistExists: boolean): ServiceState {
  if (exitCode === 0) return /state\s*=\s*running/.test(output) ? 'running' : 'stopped';
  return plistExists ? 'stopped' : 'not-installed';
}
