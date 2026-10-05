// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { statusStrings } from './i18n.js';

// jsdom replaces the global URL, so resolve paths from the module file name instead.
const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'renderer', 'status.html'), 'utf8');
const script = readFileSync(join(here, 'renderer', 'status.js'), 'utf8');

const status = {
  mode: 'standalone',
  serverState: 'running',
  serviceState: 'not-installed',
  serviceSupported: true,
  port: 7420,
  url: 'http://127.0.0.1:7420',
  dataDir: '/tmp/data',
  version: '1.0.0',
  serverVersion: '1.0.0',
  serverMode: 'standalone',
  platform: 'linux',
  busy: null,
  logs: [],
  keepInTray: true,
  locale: 'ms',
  intlTag: 'ms-MY',
  strings: statusStrings('ms'),
};

const updateState = {
  isHost: true,
  status: 'available',
  currentVersion: '1.0.0',
  release: { version: '1.2.3', prerelease: false, notes: '', assetSha256: null, assetSize: null },
  transfer: null,
  canInstall: false,
  checkedAt: null,
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('status page', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the rendered update status across status polls', async () => {
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const getStatus = vi.fn(async () => status);
    Object.assign(window, {
      wati: {
        getStatus,
        onStatusChanged: () => {},
        openMain: () => {},
        openLogs: () => {},
        resetAdmin: () => {},
        enableService: () => {},
        disableService: () => {},
        startService: () => {},
        stopService: () => {},
        setKeepInTray: async () => {},
      },
      watiUpdates: {
        getState: async () => updateState,
        check: async () => updateState,
        onChanged: () => {},
        openDownload: () => {},
        openRelease: () => {},
      },
    });
    const intervals: Array<() => void> = [];
    vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void) => {
      intervals.push(fn);
      return 0;
    }) as typeof window.setInterval);

    new window.Function(script)();
    await flush();
    await flush();

    const state = () => document.getElementById('updates-state')!.textContent;
    expect(document.documentElement.lang).toBe('ms');
    expect(state()).toContain('1.2.3');

    // the 5 s poll re-renders the status payload; it must not reset the update card
    for (const tick of intervals) tick();
    await flush();
    expect(getStatus.mock.calls.length).toBeGreaterThan(1);
    expect(state()).toContain('1.2.3');
  });
});
