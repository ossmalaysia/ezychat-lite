const USER_WINDOW_MS = 15 * 60 * 1000;
const USER_MAX_FAILURES = 5;
const USER_LOCK_MS = 15 * 60 * 1000;
const IP_WINDOW_MS = 60 * 1000;
const IP_MAX_ATTEMPTS = 20;
const PRUNE_THRESHOLD = 5000;

interface UserState {
  failures: number[];
  lockedUntil: number;
}

/**
 * In-memory login limiter.
 * - 5 failures per username within 15 min → username locked for 15 min (case-insensitive).
 * - 20 login attempts per IP per 60 s. Every `check()` that passes counts as one IP attempt.
 */
export class LoginRateLimiter {
  private readonly users = new Map<string, UserState>();
  private readonly ips = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  check(username: string, ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
    const t = this.now();
    this.maybePrune(t);

    const u = this.users.get(key(username));
    if (u && u.lockedUntil > t) return { ok: false, retryAfterSec: Math.ceil((u.lockedUntil - t) / 1000) };

    const attempts = (this.ips.get(ip) ?? []).filter((x) => x > t - IP_WINDOW_MS);
    if (attempts.length >= IP_MAX_ATTEMPTS) {
      this.ips.set(ip, attempts);
      const oldest = attempts[0] ?? t;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + IP_WINDOW_MS - t) / 1000)) };
    }
    attempts.push(t);
    this.ips.set(ip, attempts);
    return { ok: true };
  }

  recordFailure(username: string, _ip: string): void {
    const t = this.now();
    const k = key(username);
    const u = this.users.get(k) ?? { failures: [], lockedUntil: 0 };
    u.failures = u.failures.filter((x) => x > t - USER_WINDOW_MS);
    u.failures.push(t);
    if (u.failures.length >= USER_MAX_FAILURES) {
      u.lockedUntil = t + USER_LOCK_MS;
      u.failures = [];
    }
    this.users.set(k, u);
  }

  recordSuccess(username: string): void {
    this.users.delete(key(username));
  }

  private maybePrune(t: number): void {
    if (this.users.size + this.ips.size < PRUNE_THRESHOLD) return;
    for (const [k, u] of this.users) {
      if (u.lockedUntil <= t && u.failures.every((x) => x <= t - USER_WINDOW_MS)) this.users.delete(k);
    }
    for (const [k, a] of this.ips) {
      if (a.every((x) => x <= t - IP_WINDOW_MS)) this.ips.delete(k);
    }
  }
}

function key(username: string): string {
  return username.trim().toLowerCase();
}
