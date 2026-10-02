// Detects a running WA Team Inbox server on a local port. Pure (no electron import).

export type ServerMode = 'standalone' | 'service' | 'dev';
export interface ProbeResult {
  mode: ServerMode;
  version: string;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

const MODES: readonly string[] = ['standalone', 'service', 'dev'];

/** GET http://127.0.0.1:<port>/api/health with a timeout; null unless it is a WA Team Inbox server. */
export async function probeServer(
  port: number,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 1500,
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
      const body = (await res.json()) as { app?: unknown; version?: unknown; mode?: unknown } | null;
      if (!body || body.app !== 'wa-team-inbox') return null;
      if (typeof body.mode !== 'string' || !MODES.includes(body.mode)) return null;
      return { mode: body.mode as ServerMode, version: typeof body.version === 'string' ? body.version : 'unknown' };
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
  opts: { timeoutMs?: number; intervalMs?: number; fetchImpl?: FetchLike; isCancelled?: () => boolean } = {},
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
