import { describe, expect, it, vi } from 'vitest';
import { defineProduct, LITE_PRODUCT, type Product } from './product.js';
import {
  checkStatusSections,
  isAllowedExternalHref,
  orderProviders,
  parseActionRequest,
  sanitizeModel,
  StatusSectionsHost,
  type StatusSectionModel,
  type StatusSectionProvider,
} from './status-sections.js';

const licence: StatusSectionModel = {
  id: 'licence',
  title: 'Licence',
  badge: { text: 'Trial', tone: 'warning' },
  headline: '12 days left',
  message: 'Register this computer to keep using the app.',
  notice: { tone: 'info', text: 'We emailed you a code.' },
  steps: ['Enter your email', 'Enter the code'],
  rows: [{ label: 'Company', value: 'Demo Sdn Bhd' }],
  fields: [
    { id: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com' },
    { id: 'code', label: 'Code', type: 'code', hint: '6 digits' },
  ],
  buttons: [
    { id: 'send', label: 'Send code', primary: true },
    { id: 'mail', label: 'Email support', kind: 'mailto', href: 'mailto:general@anchorsprint.com' },
    { id: 'site', label: 'Website', kind: 'link', href: 'https://ezychat.ai/pricing' },
  ],
  details: [{ label: 'Install ID', value: 'abc' }],
};

function provider(overrides: Partial<StatusSectionProvider> = {}): StatusSectionProvider {
  return {
    id: 'licensing',
    getModel: vi.fn(async () => licence),
    onAction: vi.fn(async () => ({ ok: true, message: 'Code sent.' })),
    ...overrides,
  };
}

describe('external address allowlist', () => {
  it.each([
    ['https://ezychat.ai/', true],
    ['mailto:general@anchorsprint.com', true],
    ['http://ezychat.ai/', false],
    ['file:///C:/Windows/System32/calc.exe', false],
    ['javascript:alert(1)', false],
    ['https://user:pass@ezychat.ai/', false],
    ['ms-settings:privacy', false],
    ['mailto:', false],
    ['not a url', false],
  ])('%s -> %s', (href, allowed) => {
    expect(isAllowedExternalHref(href)).toBe(allowed);
  });
});

describe('sanitizeModel', () => {
  it('keeps a complete model unchanged', () => {
    expect(sanitizeModel(licence)).toEqual({
      ...licence,
      buttons: [
        { id: 'send', label: 'Send code', primary: true, kind: 'action' },
        licence.buttons![1],
        licence.buttons![2],
      ],
    });
  });

  it('drops unknown tones, field types, bad ids and link buttons with unsafe addresses', () => {
    const model = sanitizeModel({
      id: 'x',
      title: 'X',
      badge: { text: 'B', tone: 'purple' },
      notice: { tone: 'loud', text: 'N' },
      fields: [
        { id: 'a', label: 'A', type: 'password' },
        { id: 'bad id', label: 'B', type: 'text' },
        { id: 'c', label: 'C', type: 'text' },
        { id: 'c', label: 'C again', type: 'text' },
      ],
      buttons: [
        { id: 'l', label: 'L', kind: 'link', href: 'file:///etc/passwd' },
        { id: 'm', label: 'M', kind: 'mailto', href: 'https://ezychat.ai/' },
        { id: 'h', label: 'H', kind: 'link', href: 'mailto:a@b.c' },
        { id: 'k', label: 'K', kind: 'exec' },
        { id: 'ok', label: 'OK' },
      ],
      extra: '<script>',
    });
    expect(model).toEqual({
      id: 'x',
      title: 'X',
      fields: [{ id: 'c', label: 'C', type: 'text' }],
      buttons: [{ id: 'ok', label: 'OK', kind: 'action' }],
    });
  });

  it('rejects models without an id or title', () => {
    expect(sanitizeModel(null)).toBeNull();
    expect(sanitizeModel({ id: 'x' })).toBeNull();
    expect(sanitizeModel({ id: '1 2', title: 'T' })).toBeNull();
  });
});

describe('providers', () => {
  it('orders by order, then definition order, keeping the first duplicate', () => {
    const a = provider({ id: 'a' });
    const b = provider({ id: 'b', order: 1 });
    const c = provider({ id: 'c', order: 0 });
    const a2 = provider({ id: 'a', order: -1 });
    expect(orderProviders([a, b, c, a2]).map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('defineProduct validates statusSections and keeps Lite unchanged', () => {
    const base: Product = { ...LITE_PRODUCT, edition: 'enterprise' };
    const p = defineProduct({ ...base, statusSections: [provider()] });
    expect(p.statusSections).toHaveLength(1);
    expect(() => defineProduct({ ...base, statusSections: [provider(), provider()] })).toThrow(
      /duplicate/,
    );
    expect(() =>
      checkStatusSections([{ id: 'x', getModel: () => null } as unknown as StatusSectionProvider]),
    ).toThrow(/onAction/);
    expect('statusSections' in defineProduct(LITE_PRODUCT)).toBe(false);
  });
});

describe('parseActionRequest', () => {
  it('accepts ids and string values only', () => {
    expect(
      parseActionRequest({ sectionId: 'licence', buttonId: 'send', values: { a: 'b' } }),
    ).toEqual({ sectionId: 'licence', buttonId: 'send', values: { a: 'b' } });
    for (const bad of [
      null,
      'x',
      { sectionId: 'licence' },
      { sectionId: 'licence', buttonId: 'send', values: { a: 1 } },
      { sectionId: 'licence', buttonId: 'send', values: { a: 'x'.repeat(501) } },
      { sectionId: 'licence', buttonId: 'send', href: 'file:///x' },
    ]) {
      expect(() => parseActionRequest(bad)).toThrow('Invalid');
    }
  });
});

function host(p: StatusSectionProvider, extra: { openExternal?: (href: string) => void } = {}) {
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const onChanged = vi.fn();
  const openExternal = vi.fn(extra.openExternal ?? (() => undefined));
  const h = new StatusSectionsHost({
    providers: [p],
    context: () => ({ serverUrl: 'http://127.0.0.1:7420' }),
    onChanged,
    openExternal,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return { cancel: () => (t.cancelled = true) };
    },
  });
  return { h, timers, onChanged, openExternal };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('StatusSectionsHost', () => {
  it('polls providers with the server URL and the default 30 s interval', async () => {
    const p = provider();
    const { h, timers, onChanged } = host(p);
    h.start();
    await flush();
    expect(p.getModel).toHaveBeenCalledWith({ serverUrl: 'http://127.0.0.1:7420' });
    expect(onChanged).toHaveBeenCalledOnce();
    expect(h.views()).toEqual([{ provider: 'licensing', model: sanitizeModel(licence) }]);
    expect(timers.at(-1)!.ms).toBe(30_000);
    // an unchanged model does not re-broadcast
    timers.at(-1)!.fn();
    await flush();
    expect(p.getModel).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledOnce();
    h.stop();
    expect(timers.at(-1)!.cancelled).toBe(true);
  });

  it('honours refreshMs and keeps the last model when a refresh fails', async () => {
    const getModel = vi
      .fn()
      .mockResolvedValueOnce(licence)
      .mockRejectedValueOnce(new Error('offline'));
    const { h, timers } = host(provider({ getModel, refreshMs: 60_000 }));
    h.start();
    await flush();
    expect(timers.at(-1)!.ms).toBe(60_000);
    timers.at(-1)!.fn();
    await flush();
    expect(h.views()).toHaveLength(1);
  });

  it('passes only the section field values to onAction and refreshes afterwards', async () => {
    const p = provider();
    const { h } = host(p);
    h.start();
    await flush();
    const result = await h.runAction({
      sectionId: 'licence',
      buttonId: 'send',
      values: { email: 'a@b.c', code: '123456', injected: 'x' },
    });
    expect(result).toEqual({ ok: true, message: 'Code sent.' });
    expect(p.onAction).toHaveBeenCalledWith(
      'send',
      { email: 'a@b.c', code: '123456' },
      { serverUrl: 'http://127.0.0.1:7420' },
    );
    expect(p.getModel).toHaveBeenCalledTimes(2);
  });

  it('opens mailto/https buttons from its own model and rejects unknown buttons', async () => {
    const p = provider();
    const { h, openExternal } = host(p);
    h.start();
    await flush();
    await expect(
      h.runAction({ sectionId: 'licence', buttonId: 'mail', values: {} }),
    ).resolves.toEqual({ ok: true });
    await h.runAction({ sectionId: 'licence', buttonId: 'site', values: {} });
    expect(openExternal.mock.calls).toEqual([
      ['mailto:general@anchorsprint.com'],
      ['https://ezychat.ai/pricing'],
    ]);
    await expect(
      h.runAction({ sectionId: 'licence', buttonId: 'nope', values: {} }),
    ).resolves.toEqual({ ok: false });
    await expect(
      h.runAction({ sectionId: 'other', buttonId: 'send', values: {} }),
    ).resolves.toEqual({ ok: false });
    expect(p.onAction).not.toHaveBeenCalled();
  });

  it('turns a throwing action into a plain failure', async () => {
    const p = provider({ onAction: vi.fn(async () => Promise.reject(new Error('secret detail'))) });
    const { h } = host(p);
    h.start();
    await flush();
    await expect(
      h.runAction({ sectionId: 'licence', buttonId: 'send', values: {} }),
    ).resolves.toEqual({ ok: false });
  });
});
