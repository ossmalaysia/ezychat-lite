/** Only the configured loopback inbox is an application document. */
export function isInboxUrl(value: string, base: string | null): boolean {
  try {
    if (!base) return false;
    const inbox = new URL(base);
    const target = new URL(value);
    return (
      inbox.protocol === 'http:' &&
      inbox.hostname === '127.0.0.1' &&
      target.origin === inbox.origin &&
      !target.username &&
      !target.password
    );
  } catch {
    return false;
  }
}

/** Both permission requests and synchronous checks use the requesting frame, not just its parent. */
export function inboxPermissionAllowed(
  permission: string,
  currentUrl: string,
  requestingUrl: string,
  isMainFrame: boolean,
  base: string | null,
): boolean {
  return (
    isMainFrame &&
    isInboxUrl(currentUrl, base) &&
    isInboxUrl(requestingUrl, base) &&
    ['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission)
  );
}
