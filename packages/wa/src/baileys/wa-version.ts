/**
 * The WhatsApp Web version to announce, looked up from Baileys' GitHub copy without ever blocking a
 * connect: the lookup has no timeout of its own, so a slow or throttled raw.githubusercontent.com
 * held every connect (and every new QR) at "connecting" forever. Bounded by `timeoutMs`, cached so
 * reconnects and QR refreshes do not ask again; a failure falls back to Baileys' bundled version.
 */
export type WaVersion = [number, number, number];

export interface WaVersionSourceOptions {
  fetchLatest: () => Promise<{ version: WaVersion }>;
  timeoutMs?: number;
  /** How long a fetched version is reused. */
  ttlMs?: number;
  /** How long to skip the lookup after a failure or timeout. */
  failureTtlMs?: number;
  now?: () => number;
}

export const WA_VERSION_TIMEOUT_MS = 5_000;
const WA_VERSION_TTL_MS = 6 * 60 * 60_000;
const WA_VERSION_FAILURE_TTL_MS = 10 * 60_000;

export interface WaVersionLookup {
  version: WaVersion | undefined;
  /** Set when this call tried the lookup and it failed or timed out. */
  error?: unknown;
}

export function createWaVersionSource(opts: WaVersionSourceOptions) {
  const timeoutMs = opts.timeoutMs ?? WA_VERSION_TIMEOUT_MS;
  const ttlMs = opts.ttlMs ?? WA_VERSION_TTL_MS;
  const failureTtlMs = opts.failureTtlMs ?? WA_VERSION_FAILURE_TTL_MS;
  const now = opts.now ?? Date.now;
  let cached: { version: WaVersion | undefined; until: number } | null = null;
  let inflight: Promise<WaVersionLookup> | null = null;

  const lookup = async (): Promise<WaVersionLookup> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`WA version lookup timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
        timer.unref?.();
      });
      const { version } = await Promise.race([opts.fetchLatest(), timeout]);
      cached = { version, until: now() + ttlMs };
      return { version };
    } catch (error) {
      cached = { version: cached?.version, until: now() + failureTtlMs };
      return { version: cached.version, error };
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    get(): Promise<WaVersionLookup> {
      if (cached && now() < cached.until) return Promise.resolve({ version: cached.version });
      inflight ??= lookup().finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}
