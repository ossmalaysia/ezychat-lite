import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { dataMoveCommands, DataMoveError } from './data-move.js';

describe('dataMoveCommands', () => {
  it('refuses when target already has app.db', () => {
    const exists = (p: string) => p === join('/to', 'app.db') || p === '/from';
    expect(() => dataMoveCommands('darwin', '/from', '/to', exists)).toThrow(DataMoveError);
  });

  it('returns nothing when source is missing', () => {
    expect(dataMoveCommands('darwin', '/from', '/to', () => false)).toEqual([]);
  });

  it('builds posix commands with an in-script guard', () => {
    const cmds = dataMoveCommands('darwin', '/from dir', '/to', (p) => p === '/from dir');
    const s = cmds.join('\n');
    expect(s).toContain("'/to/app.db'");
    expect(s).toContain("mkdir -p '/to'");
    expect(s).toContain("cp -a '/from dir'/. '/to'/");
    expect(s).toContain("rm -rf '/from dir'");
  });

  it('builds PowerShell commands on Windows', () => {
    const cmds = dataMoveCommands('win32', 'C:\\Users\\me\\data', 'C:\\ProgramData\\wa-team-inbox', (p) => p === 'C:\\Users\\me\\data');
    const s = cmds.join('\n');
    expect(s).toContain("Test-Path -LiteralPath (Join-Path 'C:\\ProgramData\\wa-team-inbox' 'app.db')");
    expect(s).toContain('Move-Item');
    expect(s).toContain("Remove-Item -LiteralPath 'C:\\Users\\me\\data'");
  });

  it('without an exists check (unknown), still emits guarded commands', () => {
    const cmds = dataMoveCommands('win32', 'C:\\a', 'C:\\b', null);
    expect(cmds.join('\n')).toContain("if (Test-Path -LiteralPath 'C:\\a')");
  });
});
