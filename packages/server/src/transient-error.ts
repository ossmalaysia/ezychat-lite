/** Network error codes that mean "the network hiccuped", not "our process state is broken". */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * True when `err` (or anything in its `cause` chain) is a transient network failure, e.g. undici's
 * `TypeError: terminated` caused by `read ECONNRESET` escaping from a media download stream.
 * Such errors must not take the whole server down via uncaughtException.
 */
export function isTransientNetworkError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
