import { describe, expect, it } from 'vitest';
import {
  parseScQuery,
  psQuote,
  quoteWinArg,
  windowsInstallScript,
  windowsUninstallScript,
  winswXml,
} from './windows.js';

const base = {
  id: 'wa-team-inbox',
  name: 'WA Team Inbox Server',
  exe: 'C:\\Program Files\\WA Team Inbox\\WA Team Inbox.exe',
  args: ['C:\\Program Files\\WA Team Inbox\\resources\\app.asar\\dist\\server\\server.cjs', '--data', 'C:\\ProgramData\\wa-team-inbox', '--mode', 'service', '--note', 'a "quoted" & <tag>'],
  env: { ELECTRON_RUN_AS_NODE: '1', WATI_VERSION: '0.1.0' },
  logDir: 'C:\\ProgramData\\wa-team-inbox\\service\\logs',
};

describe('quoteWinArg', () => {
  it('leaves simple args alone', () => {
    expect(quoteWinArg('--data')).toBe('--data');
  });
  it('quotes args with spaces', () => {
    expect(quoteWinArg('C:\\Program Files\\x')).toBe('"C:\\Program Files\\x"');
  });
  it('escapes embedded quotes', () => {
    expect(quoteWinArg('a "b"')).toBe('"a \\"b\\""');
  });
  it('doubles trailing backslashes before closing quote', () => {
    expect(quoteWinArg('C:\\a b\\')).toBe('"C:\\a b\\\\"');
  });
  it('quotes empty string', () => {
    expect(quoteWinArg('')).toBe('""');
  });
});

describe('winswXml', () => {
  const xml = winswXml(base);
  it('contains id, name, executable', () => {
    expect(xml).toContain('<id>wa-team-inbox</id>');
    expect(xml).toContain('<name>WA Team Inbox Server</name>');
    expect(xml).toContain('<executable>C:\\Program Files\\WA Team Inbox\\WA Team Inbox.exe</executable>');
  });
  it('contains XML-escaped, command-line quoted arguments', () => {
    expect(xml).toContain(
      '<arguments>&quot;C:\\Program Files\\WA Team Inbox\\resources\\app.asar\\dist\\server\\server.cjs&quot; --data C:\\ProgramData\\wa-team-inbox --mode service --note &quot;a \\&quot;quoted\\&quot; &amp; &lt;tag&gt;&quot;</arguments>',
    );
  });
  it('sets ELECTRON_RUN_AS_NODE env', () => {
    expect(xml).toContain('<env name="ELECTRON_RUN_AS_NODE" value="1"/>');
    expect(xml).toContain('<env name="WATI_VERSION" value="0.1.0"/>');
  });
  it('starts automatically and restarts on failure', () => {
    expect(xml).toContain('<startmode>Automatic</startmode>');
    expect(xml).toContain('<onfailure action="restart" delay="5 sec"/>');
  });
  it('rolls logs by size into logDir', () => {
    expect(xml).toContain('<logpath>C:\\ProgramData\\wa-team-inbox\\service\\logs</logpath>');
    expect(xml).toContain('<log mode="roll-by-size">');
  });
  it('is well-formed (one root, balanced service tag)', () => {
    expect(xml.trim().startsWith('<?xml')).toBe(true);
    expect(xml.match(/<service>/g)?.length).toBe(1);
    expect(xml.trim().endsWith('</service>')).toBe(true);
  });
});

describe('psQuote', () => {
  it('wraps in single quotes and doubles embedded quotes', () => {
    expect(psQuote("C:\\it's")).toBe("'C:\\it''s'");
  });
});

describe('windowsInstallScript', () => {
  const script = windowsInstallScript({
    ...base,
    winswSource: 'C:\\Program Files\\WA Team Inbox\\resources\\winsw\\WinSW-x64.exe',
    serviceDir: 'C:\\ProgramData\\wa-team-inbox\\service',
    dataDir: 'C:\\ProgramData\\wa-team-inbox',
    moveFrom: 'C:\\Users\\me\\AppData\\Roaming\\WA Team Inbox\\data',
    exists: (p: string) => p.endsWith('WA Team Inbox\\data'),
  });
  it('copies winsw as <id>.exe and writes the xml', () => {
    expect(script).toContain("Copy-Item -LiteralPath 'C:\\Program Files\\WA Team Inbox\\resources\\winsw\\WinSW-x64.exe'");
    expect(script).toContain("'C:\\ProgramData\\wa-team-inbox\\service\\wa-team-inbox.exe'");
    expect(script).toContain("'C:\\ProgramData\\wa-team-inbox\\service\\wa-team-inbox.xml'");
    expect(script).toContain('<startmode>Automatic</startmode>');
  });
  it('moves data, restricts ACL to SYSTEM + Administrators, installs and starts', () => {
    const iMove = script.indexOf('Move-Item');
    const iAcl = script.indexOf('icacls');
    const iInstall = script.indexOf(' install');
    const iStart = script.indexOf(' start');
    expect(iMove).toBeGreaterThan(-1);
    expect(iAcl).toBeGreaterThan(iMove);
    expect(script).toContain('/inheritance:r');
    expect(script).toContain('*S-1-5-18:(OI)(CI)F');
    expect(script).toContain('*S-1-5-32-544:(OI)(CI)F');
    expect(iInstall).toBeGreaterThan(iAcl);
    expect(iStart).toBeGreaterThan(iInstall);
  });
});

describe('windowsUninstallScript', () => {
  it('stops + uninstalls the service, then moves data back and resets ACLs', () => {
    const s = windowsUninstallScript({
      id: 'wa-team-inbox',
      serviceDir: 'C:\\ProgramData\\wa-team-inbox\\service',
      dataDir: 'C:\\ProgramData\\wa-team-inbox',
      moveTo: 'C:\\Users\\me\\data',
    });
    const iStop = s.indexOf(' stop');
    const iUninst = s.indexOf(' uninstall');
    const iMove = s.indexOf('Move-Item');
    expect(iStop).toBeGreaterThan(-1);
    expect(iUninst).toBeGreaterThan(iStop);
    expect(iMove).toBeGreaterThan(iUninst);
    expect(s).toContain('/reset');
  });
});

describe('parseScQuery', () => {
  it('detects running', () => {
    expect(parseScQuery(0, 'SERVICE_NAME: x\n        STATE              : 4  RUNNING')).toBe('running');
  });
  it('detects stopped', () => {
    expect(parseScQuery(0, 'STATE              : 1  STOPPED')).toBe('stopped');
  });
  it('detects not installed (1060)', () => {
    expect(parseScQuery(1060, '[SC] EnumQueryServicesStatus:OpenService FAILED 1060')).toBe('not-installed');
  });
});
