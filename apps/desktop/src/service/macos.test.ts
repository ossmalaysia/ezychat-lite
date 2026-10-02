import { describe, expect, it } from 'vitest';
import { launchdPlist, macInstallScript, macUninstallScript, parseLaunchctlPrint, shQuote } from './macos.js';

const opts = {
  label: 'org.ossmalaysia.wateaminbox.server',
  program: '/Applications/WA Team Inbox.app/Contents/MacOS/WA Team Inbox',
  args: ['/Applications/WA Team Inbox.app/Contents/Resources/app.asar/dist/server/server.cjs', '--data', '/Library/Application Support/wa-team-inbox', '--x', 'a&b<c>'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
  logDir: '/Library/Application Support/wa-team-inbox/logs',
};

describe('launchdPlist', () => {
  const xml = launchdPlist(opts);
  it('is a plist document', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<!DOCTYPE plist');
    expect(xml.trim().endsWith('</plist>')).toBe(true);
  });
  it('has label, RunAtLoad and KeepAlive true', () => {
    expect(xml).toMatch(/<key>Label<\/key>\s*<string>org\.ossmalaysia\.wateaminbox\.server<\/string>/);
    expect(xml).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(xml).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });
  it('has ProgramArguments array: program first, then escaped args', () => {
    const m = xml.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
    expect(m).not.toBeNull();
    const items = [...m![1]!.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((x) => x[1]);
    expect(items).toEqual([
      opts.program,
      opts.args[0],
      '--data',
      '/Library/Application Support/wa-team-inbox',
      '--x',
      'a&amp;b&lt;c&gt;',
    ]);
  });
  it('has env dict and log paths', () => {
    expect(xml).toMatch(/<key>EnvironmentVariables<\/key>\s*<dict>\s*<key>ELECTRON_RUN_AS_NODE<\/key>\s*<string>1<\/string>/);
    expect(xml).toContain('<key>StandardOutPath</key>');
    expect(xml).toContain('<string>/Library/Application Support/wa-team-inbox/logs/service.out.log</string>');
    expect(xml).toContain('<key>StandardErrorPath</key>');
  });
  it('balances dict/array tags', () => {
    expect(xml.match(/<dict>/g)?.length).toBe(xml.match(/<\/dict>/g)?.length);
    expect(xml.match(/<array>/g)?.length).toBe(xml.match(/<\/array>/g)?.length);
  });
});

describe('shQuote', () => {
  it('single-quotes and escapes embedded single quotes', () => {
    expect(shQuote("it's here")).toBe("'it'\\''s here'");
  });
});

describe('macInstallScript', () => {
  const s = macInstallScript({
    ...opts,
    dataDir: '/Library/Application Support/wa-team-inbox',
    moveFrom: '/Users/me/Library/Application Support/WA Team Inbox/data',
    exists: (p: string) => p.endsWith('WA Team Inbox/data'),
  });
  it('writes plist with root ownership and 644, chmod 700 data, bootstraps', () => {
    expect(s).toContain("'/Library/LaunchDaemons/org.ossmalaysia.wateaminbox.server.plist'");
    expect(s).toContain('chown root:wheel');
    expect(s).toContain('chmod 644');
    expect(s).toContain('chmod 700');
    expect(s).toContain('launchctl bootstrap system');
    expect(s.indexOf('launchctl bootstrap')).toBeGreaterThan(s.indexOf('chmod 700'));
  });
  it('moves data before bootstrapping', () => {
    expect(s.indexOf('cp -a')).toBeGreaterThan(-1);
    expect(s.indexOf('cp -a')).toBeLessThan(s.indexOf('launchctl bootstrap'));
  });
});

describe('macUninstallScript', () => {
  it('boots out, removes plist, moves data back and chowns to user', () => {
    const s = macUninstallScript({
      label: opts.label,
      dataDir: '/Library/Application Support/wa-team-inbox',
      moveTo: '/Users/me/data',
      owner: 'me',
    });
    expect(s.indexOf('launchctl bootout')).toBeLessThan(s.indexOf('cp -a'));
    expect(s).toContain("rm -f '/Library/LaunchDaemons/org.ossmalaysia.wateaminbox.server.plist'");
    expect(s).toContain("chown -R 'me'");
  });
});

describe('parseLaunchctlPrint', () => {
  it('running', () => {
    expect(parseLaunchctlPrint(0, 'system/x = {\n\tstate = running\n', true)).toBe('running');
  });
  it('loaded but not running', () => {
    expect(parseLaunchctlPrint(0, 'state = not running', true)).toBe('stopped');
  });
  it('not loaded but plist present → stopped', () => {
    expect(parseLaunchctlPrint(113, 'Could not find service', true)).toBe('stopped');
  });
  it('not loaded and no plist → not-installed', () => {
    expect(parseLaunchctlPrint(113, 'Could not find service', false)).toBe('not-installed');
  });
});
