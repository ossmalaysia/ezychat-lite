// Detects a running server of this product on a local port. Pure (no electron import).
import { activeProduct, type Product } from './product.js';

export type ServerMode = 'standalone' | 'service' | 'dev';
export interface ProbeResult {
  mode: ServerMode;
  version: string;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

const MODES: readonly string[] = ['standalone', 'service', 'dev'];

/**
 * GET http://127.0.0.1:<port>/api/health with a timeout; null unless it is this product's server:
 * `app` must be `product.healthApp` and `edition` (`lite` when absent, as before editions existed)
 * must be `product.edition`, so one edition never adopts the other's server.
 */
export async function probeServer(
  port: number,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 1500,
  product: Product = activeProduct(),
): Promise<ProbeResult | null> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(null);
    }, timeoutMs);
  });
  const attempt = (async (): Promise<ProbeResult | null> => {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/api/health`, { signal: ctrl.signal });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        app?: unknown;
        edition?: unknown;
        version?: unknown;
        mode?: unknown;
      } | null;
      if (!body || body.app !== product.healthApp) return null;
      if ((body.edition ?? 'lite') !== product.edition) return null;
      if (typeof body.mode !== 'string' || !MODES.includes(body.mode)) return null;
      return {
        mode: body.mode as ServerMode,
        version: typeof body.version === 'string' ? body.version : 'unknown',
      };
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Polls probeServer until it answers or the deadline passes. */
export async function waitForServer(
  port: number,
  opts: {
    timeoutMs?: number;
    intervalMs?: number;
    fetchImpl?: FetchLike;
    isCancelled?: () => boolean;
  } = {},
): Promise<ProbeResult | null> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (opts.isCancelled?.()) return null;
    const r = await probeServer(port, opts.fetchImpl ?? fetch);
    if (r) return r;
    await new Promise((res) => setTimeout(res, opts.intervalMs ?? 500));
  }
  return null;
}
