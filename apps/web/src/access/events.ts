/**
 * Access gate signals between the API client / socket and the `AccessGate` component. An edition
 * may close the server's access gate (e.g. no licence): every /api call then answers 403 with the
 * gate's code as a plain string (`{ error: "<code>" }`), unlike ordinary errors
 * (`{ error: { code, message } }`).
 */
export const ACCESS_CLOSED_EVENT = 'ezychat:access-closed';
/** Ask the gate to read GET /api/access again (e.g. the realtime socket was refused). */
export const ACCESS_RECHECK_EVENT = 'ezychat:access-recheck';

export interface AccessClosedDetail {
  code: string;
}

const CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** The gate code in a 403 body, or null when the body is an ordinary error. */
export function accessGateCode(status: number, body: unknown): string | null {
  if (status !== 403 || typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  return typeof error === 'string' && CODE_PATTERN.test(error) ? error : null;
}

export function dispatchAccessClosed(code: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<AccessClosedDetail>(ACCESS_CLOSED_EVENT, { detail: { code } }),
  );
}

export function dispatchAccessRecheck(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ACCESS_RECHECK_EVENT));
}
