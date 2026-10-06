/** Fixed-window limiter keyed by a string (an admin's user id); memory is bounded by `maxKeys`. */
export class WindowLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();
  private readonly now: () => number;

  constructor(
    private readonly opts: { windowMs: number; max: number; maxKeys?: number; now?: () => number },
  ) {
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.hits.size;
  }

  hit(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = this.now();
    let entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.opts.windowMs) {
      this.hits.delete(key);
      while (this.hits.size >= (this.opts.maxKeys ?? 1000)) {
        const oldest = this.hits.keys().next().value;
        if (oldest === undefined) break;
        this.hits.delete(oldest);
      }
      entry = { start: now, count: 0 };
      this.hits.set(key, entry);
    }
    entry.count++;
    const allowed = entry.count <= this.opts.max;
    return {
      allowed,
      retryAfterSec: allowed ? 0 : Math.ceil((entry.start + this.opts.windowMs - now) / 1000),
    };
  }
}
