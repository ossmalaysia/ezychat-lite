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
    // the heading names the product: Lite falls back to its name when the field is missing
    expect(document.getElementById('title')!.textContent).toBe('EzyChat Lite v1.0.0');
  });

  it("names another edition's product in the heading", async () => {
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const noop = () => {};
    Object.assign(window, {
      wati: {
        getStatus: async () => ({ ...status, productName: 'EzyChat Enterprise' }),
        onStatusChanged: noop,
        openMain: noop,
        openLogs: noop,
        resetAdmin: noop,
        enableService: noop,
        disableService: noop,
        startService: noop,
        stopService: noop,
        setKeepInTray: async () => {},
      },
      watiUpdates: {
        getState: async () => updateState,
        check: async () => updateState,
        onChanged: noop,
        openDownload: noop,
        openRelease: noop,
      },
    });
    vi.spyOn(window, 'setInterval').mockImplementation((() => 0) as typeof window.setInterval);
    new window.Function(script)();
    await flush();
    await flush();
    expect(document.getElementById('title')!.textContent).toBe('EzyChat Enterprise v1.0.0');
  });
  it('renders edition sections above App updates and sends field values with actions', async () => {
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const noop = () => {};
    const model = {
      id: 'licence',
      title: 'Licence',
      badge: { text: 'Trial', tone: 'warning' },
      headline: '12 days left',
      message: 'Register this computer.',
      notice: { tone: 'danger', text: '<b>not html</b>' },
      steps: ['Enter your email', 'Enter the code'],
      rows: [{ label: 'Company', value: 'Demo Sdn Bhd' }],
      fields: [
        { id: 'email', label: 'Email', type: 'email', value: 'old@example.com' },
        { id: 'code', label: 'Code', type: 'code', hint: '6 digits' },
      ],
      buttons: [
        { id: 'send', label: 'Send code', primary: true, kind: 'action' },
        {
          id: 'mail',
          label: 'Email support',
          kind: 'mailto',
          href: 'mailto:general@anchorsprint.com',
        },
      ],
      details: [{ label: 'Install ID', value: 'abc' }],
    };
    let pushSections: (views: unknown) => void = noop;
    let resolveAction: (value: unknown) => void = noop;
    const sectionAction = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    Object.assign(window, {
      wati: {
        getStatus: async () => status,
        onStatusChanged: noop,
        openMain: noop,
        openLogs: noop,
        resetAdmin: noop,
        enableService: noop,
        disableService: noop,
        startService: noop,
        stopService: noop,
        setKeepInTray: async () => {},
        getSections: async () => [{ provider: 'licensing', model }],
        sectionAction,
        onSectionsChanged: (cb: (views: unknown) => void) => {
          pushSections = cb;
        },
      },
      watiUpdates: {
        getState: async () => updateState,
        check: async () => updateState,
        onChanged: noop,
        openDownload: noop,
        openRelease: noop,
      },
    });
    vi.spyOn(window, 'setInterval').mockImplementation((() => 0) as typeof window.setInterval);
    new window.Function(script)();
    await flush();
    await flush();

    const host = document.getElementById('edition-sections')!;
    expect(host.hidden).toBe(false);
    // sections come before the App updates card
    expect(
      host.compareDocumentPosition(document.getElementById('updates-card')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const card = host.querySelector('[data-section="licence"]')!;
    expect(card.querySelector('h2')!.textContent).toBe('Licence');
    expect(card.querySelector('.badge')!.className).toBe('badge warn');
    expect(card.querySelector('.headline')!.textContent).toBe('12 days left');
    const notice = card.querySelector('.notice')!;
    expect(notice.className).toBe('notice danger');
    expect(notice.textContent).toBe('<b>not html</b>');
    expect(notice.querySelector('b')).toBeNull();
    expect([...card.querySelectorAll('.steps li')].map((li) => li.textContent)).toEqual([
      'Enter your email',
      'Enter the code',
    ]);
    expect(card.querySelector('dl.rows dd')!.textContent).toBe('Demo Sdn Bhd');
    const inputs = card.querySelectorAll('input');
    expect(inputs).toHaveLength(2);
    const [email, code] = [...inputs] as HTMLInputElement[];
    expect(email.type).toBe('email');
    expect(email.value).toBe('old@example.com');
    expect(code.className).toBe('code');
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(card.querySelector('details summary')!.textContent).toBe(
      status.strings['section.details'],
    );
    const buttons = [...card.querySelectorAll('button')] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent)).toEqual(['Send code', 'Email support']);
    expect(buttons[0].className).toBe('primary');

    // typed values survive a re-render from the main process
    email.value = 'new@example.com';
    email.dispatchEvent(new Event('input'));
    code.value = '123456';
    code.dispatchEvent(new Event('input'));
    pushSections([{ provider: 'licensing', model }]);
    const again = host.querySelectorAll('input');
    expect((again[0] as HTMLInputElement).value).toBe('new@example.com');

    (host.querySelector('button[data-button="send"]') as HTMLButtonElement).click();
    await flush();
    expect(sectionAction).toHaveBeenCalledWith({
      sectionId: 'licence',
      buttonId: 'send',
      values: { email: 'new@example.com', code: '123456' },
    });
    // buttons are disabled while the action runs
    expect((host.querySelector('button[data-button="send"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
    resolveAction({ ok: false, message: 'Wrong code.' });
    await flush();
    await flush();
    expect(host.querySelector('[data-result]')!.textContent).toBe('Wrong code.');
    expect((host.querySelector('button[data-button="send"]') as HTMLButtonElement).disabled).toBe(
      false,
    );

    // the mail button names only its id; the main process opens the address from its model
    (host.querySelector('button[data-button="mail"]') as HTMLButtonElement).click();
    await flush();
    expect(sectionAction).toHaveBeenLastCalledWith({
      sectionId: 'licence',
      buttonId: 'mail',
      values: { email: 'new@example.com', code: '123456' },
    });

    pushSections([]);
    expect(host.hidden).toBe(true);
  });
});
