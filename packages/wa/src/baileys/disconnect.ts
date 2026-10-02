/**
 * Classification of Baileys disconnect status codes (spec §8).
 * Numeric values mirror Baileys' `DisconnectReason` enum; kept as literals so
 * this module stays pure and cheap to test.
 */
export type DisconnectAction = 'reconnect' | 'logged_out' | 'replaced' | 'bad_session' | 'blocked';

export const DisconnectCode = {
  loggedOut: 401,
  forbidden: 403,
  timedOut: 408, // also connectionLost
  multideviceMismatch: 411,
  connectionClosed: 428,
  connectionReplaced: 440,
  badSession: 500,
  unavailableService: 503,
  restartRequired: 515,
} as const;

export function classifyDisconnect(statusCode: number | undefined): DisconnectAction {
  switch (statusCode) {
    case DisconnectCode.loggedOut:
      return 'logged_out';
    case DisconnectCode.connectionReplaced:
      return 'replaced';
    case DisconnectCode.badSession:
      return 'bad_session';
    case DisconnectCode.forbidden:
    case DisconnectCode.multideviceMismatch:
      return 'blocked';
    // restartRequired, timedOut/connectionLost, connectionClosed, unavailableService, unknown
    default:
      return 'reconnect';
  }
}

/** Exponential backoff 2s -> 60s with +/-20% jitter. */
export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(60_000, 2000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + 0.4 * rand()));
}
