import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Product } from './product.js';

/**
 * main.ts starts Electron on import. Replace it for one test with a stub that records which product it
 * would read, from the same (fresh) module instance the entry uses.
 */
function stubMain(): string[] {
  const loaded: string[] = [];
  vi.doMock('./main.js', async () => {
    const { activeProduct } = await import('./product.js');
    loaded.push(activeProduct().edition);
    return {};
  });
  return loaded;
}

afterEach(() => {
  vi.doUnmock('./main.js');
  vi.resetModules();
});

const enterprise: Product = {
  edition: 'enterprise',
  productName: 'EzyChat Enterprise',
  appUserModelId: 'com.example.ezychat.enterprise',
  appDirName: 'ezychat-enterprise',
  profileDirName: 'EzyChat Enterprise',
  serviceId: 'ezychat-enterprise',
  serviceName: 'EzyChat Enterprise Server',
  launchdLabel: 'com.example.ezychat.enterprise.server',
  healthApp: 'wa-team-inbox',
  releaseRepository: 'example/ezychat-enterprise-releases',
  releaseRepositories: ['example/ezychat-enterprise-releases'],
  artifactPrefixes: ['EzyChat-Enterprise'],
  executableNames: ['EzyChat Enterprise'],
};

describe('@ezychat/desktop entry', () => {
  it('exports the product API and startDesktop, and loading it does not start the shell', async () => {
    const loaded = stubMain();
    const api = await import('./index.js');
    expect(Object.keys(api).sort()).toEqual([
      'LITE_PRODUCT',
      'activeProduct',
      'defineProduct',
      'setActiveProduct',
      'startDesktop',
      'updateFeedOf',
    ]);
    expect(loaded).toEqual([]);
  }, 30_000);

  it('startDesktop sets the edition product before the shell loads', async () => {
    const loaded = stubMain();
    const { activeProduct, defineProduct, startDesktop } = await import('./index.js');
    await startDesktop(defineProduct(enterprise));
    expect(loaded).toEqual(['enterprise']);
    expect(activeProduct().productName).toBe('EzyChat Enterprise');
  }, 30_000);

  it('startDesktop without a product runs as Lite', async () => {
    const loaded = stubMain();
    const { startDesktop } = await import('./index.js');
    await startDesktop();
    expect(loaded).toEqual(['lite']);
  }, 30_000);
});
