import type { Logger } from 'pino';
import type { Bus } from '../bus.js';
import type { DB } from '../db/index.js';

/** Current state of the access gate. `code` is the stable reason an edition closed it. */
export type AccessState = { open: true } | { open: false; code: string };

/**
 * Core-owned switch an edition uses to turn the app off and on again (e.g. licensing).
 * Lite never closes it. While closed, every /api and /mcp request answers 403 with `code`
 * (except the allowlist in `http/access.ts`), Socket.IO refuses clients, all sessions are deleted
 * at close, and the AI member, customer enrichment, the send queue, the tunnel and push pause.
 * WhatsApp stays connected and keeps storing what arrives.
 */
export interface AccessGate {
  /** Closes the gate (idempotent for the same code). `reason` is never logged or returned. */
  close(input: { code: string; reason?: string }): void;
  /** Opens the gate again (no-op when open). Paused services resume; users sign in again. */
  open(): void;
  state(): AccessState;
}

/** A stable machine-readable code: lower-case letters, digits and underscores (e.g. license_required). */
export const ACCESS_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function createAccessGate(deps: { db: DB; bus: Bus; log: Logger }): AccessGate {
  const log = deps.log.child({ mod: 'access' });
  let current: AccessState = { open: true };
  return {
    close({ code }) {
      if (typeof code !== 'string' || !ACCESS_CODE_PATTERN.test(code))
        throw new Error('access gate code must match /^[a-z][a-z0-9_]{0,63}$/');
      if (!current.open && current.code === code) return;
      // State first: requests and sockets racing this call are already refused.
      current = { open: false, code };
      // Everyone signs in again after reopening; no session outlives a close.
      const sessions = deps.db.prepare('DELETE FROM sessions').run().changes;
      log.warn({ code, sessions }, 'access closed');
      deps.bus.emit('access:closed', { code });
    },
    open() {
      if (current.open) return;
      const code = current.code;
      current = { open: true };
      log.info({ code }, 'access opened');
      deps.bus.emit('access:opened', {});
    },
    state: () => current,
  };
}
