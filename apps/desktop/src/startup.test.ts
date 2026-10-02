import { describe, expect, it } from 'vitest';
import { decideStartup, isRestartableExit, parsePortFile } from './startup.js';

describe('decideStartup', () => {
  it('connects when a server answers', () => {
    expect(decideStartup(true, 'running')).toBe('client');
    expect(decideStartup(true, 'not-installed')).toBe('client');
  });
  it('never starts standalone while the OS service is installed but not answering', () => {
    expect(decideStartup(false, 'running')).toBe('wait-for-service'); // still booting
    expect(decideStartup(false, 'stopped')).toBe('wait-for-service'); // stopped / crashed
  });
  it('starts standalone only when no service is installed', () => {
    expect(decideStartup(false, 'not-installed')).toBe('standalone');
  });
});

describe('isRestartableExit', () => {
  it('does not restart on bad args (2) or a locked data dir (3)', () => {
    expect(isRestartableExit(2)).toBe(false);
    expect(isRestartableExit(3)).toBe(false);
  });
  it('restarts on crashes', () => {
    expect(isRestartableExit(1)).toBe(true);
    expect(isRestartableExit(0)).toBe(true);
  });
});

describe('parsePortFile', () => {
  it('reads the port', () => {
    expect(parsePortFile('{"port":8123,"pid":42}')).toBe(8123);
  });
  it('rejects junk', () => {
    expect(parsePortFile(null)).toBeNull();
    expect(parsePortFile('nope')).toBeNull();
    expect(parsePortFile('{"port":0}')).toBeNull();
  });
});
