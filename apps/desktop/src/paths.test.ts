import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import {
  cloudflaredBinary,
  cloudflaredDir,
  machineDataDir,
  parseDesktopConfig,
  preserveInstalledProfile,
  serverEntry,
  trayIconFile,
  userDataDir,
  webDistDir,
  winswExe,
} from './paths.js';

describe('installed profile compatibility', () => {
  it.each(['C:/Users/me/AppData/Roaming', '/Users/me/Library/Application Support'])(
    'pins storage and sessions to the existing profile under %s',
    (appData) => {
      const calls: unknown[] = [];
      preserveInstalledProfile(
        {
          isPackaged: true,
          getPath: () => appData,
          setPath: (name, path) => calls.push([name, path]),
        },
        (path) => calls.push(['mkdir', path]),
      );
      const legacyProfile = join(appData, 'WA Team Inbox');
      expect(calls).toEqual([
        ['mkdir', legacyProfile],
        ['userData', legacyProfile],
        ['sessionData', legacyProfile],
      ]);
    },
  );
  it('leaves development and isolated test profiles alone', () => {
    const getPath = vi.fn();
    const setPath = vi.fn();
    const ensureDirectory = vi.fn();
    preserveInstalledProfile({ isPackaged: false, getPath, setPath }, ensureDirectory);
    expect(getPath).not.toHaveBeenCalled();
    expect(setPath).not.toHaveBeenCalled();
    expect(ensureDirectory).not.toHaveBeenCalled();
  });
});

describe('machineDataDir', () => {
  it('uses ProgramData on Windows', () => {
    expect(machineDataDir('win32', { ProgramData: 'D:\\PD' })).toBe('D:\\PD\\wa-team-inbox');
  });
  it('falls back to C:\\ProgramData when env missing', () => {
    expect(machineDataDir('win32', {})).toBe('C:\\ProgramData\\wa-team-inbox');
  });
  it('uses /Library/Application Support on macOS', () => {
    expect(machineDataDir('darwin', {})).toBe('/Library/Application Support/wa-team-inbox');
  });
  it('uses /var/lib on other platforms', () => {
    expect(machineDataDir('linux', {})).toBe('/var/lib/wa-team-inbox');
  });
});

describe('app paths', () => {
  const app = { getPath: (n: string) => (n === 'userData' ? '/u' : '/x') };
  it('userDataDir is userData/data', () => {
    expect(userDataDir(app)).toBe(join('/u', 'data'));
  });
  it('serverEntry lives under the app path (asar when packaged)', () => {
    expect(serverEntry(true, '/res', '/res/app.asar')).toBe(
      join('/res/app.asar', 'dist', 'server', 'server.cjs'),
    );
    expect(serverEntry(false, '/res', '/repo/apps/desktop')).toBe(
      join('/repo/apps/desktop', 'dist', 'server', 'server.cjs'),
    );
  });
  it('webDistDir is resources/web when packaged, apps/web/dist in dev', () => {
    expect(webDistDir(true, '/res', '/res/app.asar')).toBe(join('/res', 'web'));
    expect(webDistDir(false, '/res', '/repo/apps/desktop')).toBe(
      join('/repo/apps/desktop', '..', 'web', 'dist'),
    );
  });
  it('cloudflaredDir is resources/cloudflared when packaged, repo resources/<platform>-<arch> in dev', () => {
    expect(cloudflaredDir(true, '/res', '/res/app.asar', 'win32', 'x64')).toBe(
      join('/res', 'cloudflared'),
    );
    expect(cloudflaredDir(false, '/res', '/repo/apps/desktop', 'darwin', 'arm64')).toBe(
      join('/repo/apps/desktop', '..', '..', 'resources', 'cloudflared', 'darwin-arm64'),
    );
  });
  it('cloudflaredBinary adds .exe on Windows', () => {
    expect(cloudflaredBinary('/c', 'win32')).toBe(join('/c', 'cloudflared.exe'));
    expect(cloudflaredBinary('/c', 'darwin')).toBe(join('/c', 'cloudflared'));
  });
  it('winswExe points at resources/winsw', () => {
    expect(winswExe(true, '/res', '/res/app.asar')).toBe(join('/res', 'winsw', 'WinSW-x64.exe'));
    expect(winswExe(false, '/res', '/repo/apps/desktop')).toBe(
      join('/repo/apps/desktop', '..', '..', 'resources', 'winsw', 'WinSW-x64.exe'),
    );
  });
});

describe('parseDesktopConfig', () => {
  it('defaults port to 7420 and keeps the app in the tray', () => {
    expect(parseDesktopConfig(null)).toEqual({ port: 7420, keepInTray: true });
    expect(parseDesktopConfig('not json')).toEqual({ port: 7420, keepInTray: true });
    expect(parseDesktopConfig('{"port":"abc"}')).toEqual({ port: 7420, keepInTray: true });
  });
  it('reads a valid port', () => {
    expect(parseDesktopConfig('{"port":7500}')).toEqual({ port: 7500, keepInTray: true });
  });
  it('rejects out of range ports', () => {
    expect(parseDesktopConfig('{"port":70000}')).toEqual({ port: 7420, keepInTray: true });
  });
  it('reads the tray preference independently of the port', () => {
    expect(parseDesktopConfig('{"port":7500,"keepInTray":false}')).toEqual({
      port: 7500,
      keepInTray: false,
    });
    expect(parseDesktopConfig('{"port":70000,"keepInTray":false}')).toEqual({
      port: 7420,
      keepInTray: false,
    });
    expect(parseDesktopConfig('{"keepInTray":"no"}')).toEqual({ port: 7420, keepInTray: true });
  });
});

describe('service host + port files', () => {
  it('server host sits next to main.js in dist', async () => {
    const { serverHost } = await import('./paths.js');
    expect(serverHost(join('A', 'app'))).toBe(join('A', 'app', 'dist', 'server-host.cjs'));
  });
  it('windows service port file is in a run sub-folder of the machine data dir', async () => {
    const { servicePortFile, serviceRunDir } = await import('./paths.js');
    expect(serviceRunDir('win32', { ProgramData: 'D:\\PD' })).toBe('D:\\PD\\wa-team-inbox\\run');
    expect(servicePortFile('win32', { ProgramData: 'D:\\PD' })).toBe(
      'D:\\PD\\wa-team-inbox\\run\\port.json',
    );
  });
  it('macOS service port file is in the root-owned runtime dir (not the 700 data dir)', async () => {
    const { servicePortFile } = await import('./paths.js');
    expect(servicePortFile('darwin', {})).toBe(
      '/Library/Application Support/wa-team-inbox-runtime/port.json',
    );
  });
});

describe('trayIconFile', () => {
  it('uses the template image on macOS from resources when packaged', () => {
    expect(trayIconFile(true, '/res', '/res/app.asar', 'darwin')).toBe(
      join('/res', 'tray', 'trayTemplate.png'),
    );
  });
  it('uses tray.png on Windows from resources when packaged', () => {
    expect(trayIconFile(true, 'C:/res', 'C:/res/app.asar', 'win32')).toBe(
      join('C:/res', 'tray', 'tray.png'),
    );
  });
  it('uses build/tray next to the app in dev', () => {
    expect(trayIconFile(false, '/x', '/repo/apps/desktop', 'win32')).toBe(
      join('/repo/apps/desktop', 'build', 'tray', 'tray.png'),
    );
  });
});
