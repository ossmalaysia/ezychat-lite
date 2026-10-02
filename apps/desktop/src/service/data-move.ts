// Shell lines that move the data dir between user and machine locations. Pure (no electron).
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { psQuote } from './windows.js';
import { shQuote } from './macos.js';

export class DataMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataMoveError';
  }
}

/**
 * Returns script lines (PowerShell on win32, sh elsewhere) that move every file from `from`
 * into `to` and remove `from`. When `exists` is given (a path check the caller can perform):
 * throws DataMoveError if `to` already holds app.db (merging is not supported), and returns []
 * when `from` does not exist. The scripts repeat both checks themselves, because the caller may
 * not be able to see an ACL-restricted machine dir. Pass `exists = null` to skip the JS checks.
 */
export function dataMoveCommands(
  platform: NodeJS.Platform,
  from: string,
  to: string,
  exists: ((p: string) => boolean) | null = existsSync,
): string[] {
  if (exists) {
    if (!exists(from)) return [];
    const targetDb = platform === 'win32' ? `${to}\\app.db` : posix.join(to, 'app.db');
    if (exists(targetDb) || exists(join(to, 'app.db'))) {
      throw new DataMoveError(`Target ${to} already contains app.db; refusing to merge data directories.`);
    }
  }
  if (platform === 'win32') {
    const f = psQuote(from);
    const t = psQuote(to);
    return [
      `if (Test-Path -LiteralPath ${f}) {`,
      `  if (Test-Path -LiteralPath (Join-Path ${t} 'app.db')) { throw 'Target ${to.replace(/'/g, "''")} already contains app.db; refusing to merge.' }`,
      `  New-Item -ItemType Directory -Force -Path ${t} | Out-Null`,
      `  Get-ChildItem -LiteralPath ${f} -Force | Move-Item -Destination ${t} -Force`,
      `  Remove-Item -LiteralPath ${f} -Recurse -Force`,
      `}`,
    ];
  }
  const f = shQuote(from);
  const t = shQuote(to);
  return [
    `if [ -d ${f} ]; then`,
    `  if [ -e ${shQuote(posix.join(to, 'app.db'))} ]; then echo "Target already contains app.db; refusing to merge." >&2; exit 3; fi`,
    `  mkdir -p ${t}`,
    `  cp -a ${f}/. ${t}/`,
    `  rm -rf ${f}`,
    `fi`,
  ];
}
