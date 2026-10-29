import type { Speller } from './spelling';

/**
 * The British English Hunspell dictionary (`dictionary-en-gb`, copied to public/dictionaries/en-GB
 * and pinned by spelling.test.ts): about 0.6 MB, 0.2 MB compressed. It is fetched the first time
 * someone types while Fix English is on, then kept by the browser cache. Building the speller takes
 * a few hundred milliseconds, so it waits for an idle moment.
 */
let loading: Promise<Speller> | null = null;

async function text(res: Response): Promise<string> {
  if (!res.ok) throw new Error(`Dictionary download failed (${res.status})`);
  return res.text();
}

const idle = () =>
  new Promise<void>((resolve) => {
    const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: object) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 1_500 });
    else setTimeout(resolve, 50);
  });

/** One speller for the page; a failed download is tried again on the next call. */
export function loadSpeller(): Promise<Speller> {
  loading ??= (async () => {
    const [{ default: nspell }, aff, dic] = await Promise.all([
      import('nspell'),
      fetch('/dictionaries/en-GB/index.aff').then(text),
      fetch('/dictionaries/en-GB/index.dic').then(text),
    ]);
    await idle();
    return nspell(aff, dic);
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Tests only: forget the loaded speller. */
export function resetSpellerForTests(): void {
  loading = null;
}
