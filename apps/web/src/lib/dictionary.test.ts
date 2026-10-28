import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSpeller, resetSpellerForTests } from './dictionary';

const here = dirname(fileURLToPath(import.meta.url));
const file = (name: string) =>
  readFileSync(join(here, '../../public/dictionaries/en-GB', name), 'utf8');

afterEach(() => {
  resetSpellerForTests();
  vi.unstubAllGlobals();
});

describe('loadSpeller', () => {
  it('downloads the dictionary once and builds one speller', async () => {
    const fetch = vi.fn(
      async (url: string) => new Response(file(url.endsWith('.aff') ? 'index.aff' : 'index.dic')),
    );
    vi.stubGlobal('fetch', fetch);
    const speller = await loadSpeller();
    expect(speller.correct('colour')).toBe(true);
    expect(speller.correct('tommorow')).toBe(false);
    expect(await loadSpeller()).toBe(speller);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/dictionaries/en-GB/index.aff',
      '/dictionaries/en-GB/index.dic',
    ]);
  });

  it('tries again after a failed download', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(loadSpeller()).rejects.toThrow('Dictionary download failed (503)');
    await expect(loadSpeller()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
