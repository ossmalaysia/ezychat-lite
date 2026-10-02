// Pure startup / supervision decisions (no electron import; unit tested).
import type { ServiceState } from './service/windows.js';

export type StartupAction =
  /** a server already answers: connect to it */
  | 'client'
  /** the OS service is installed but not answering: never start a standalone server on the
   *  (now empty) user data dir, which would also take the service's port — wait for / offer to
   *  start the service instead */
  | 'wait-for-service'
  /** no service: run the server inside the app */
  | 'standalone';

export function decideStartup(serverAnswers: boolean, serviceState: ServiceState): StartupAction {
  if (serverAnswers) return 'client';
  if (serviceState !== 'not-installed') return 'wait-for-service';
  return 'standalone';
}

/**
 * Server exit codes the desktop must not restart: 2 = invalid arguments, 3 = the data dir is
 * locked by another server process (restarting would loop forever).
 */
export function isRestartableExit(code: number): boolean {
  return code !== 2 && code !== 3;
}

/** Parses the port file written by server-host ({ port, pid }); null when invalid. */
export function parsePortFile(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { port?: unknown } | null;
    const p = v?.port;
    return typeof p === 'number' && Number.isInteger(p) && p > 0 && p < 65536 ? p : null;
  } catch {
    return null;
  }
}
