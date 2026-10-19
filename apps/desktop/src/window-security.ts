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

/**
 * The link a blocked navigation should open in the OS instead: an https: or mailto: link clicked in the main
 * frame. Electron fires `will-frame-navigate` before `will-navigate`, and blocking it there cancels
 * `will-navigate`, so the main window opens external links from this check (null: block silently).
 */
export function externalLinkToOpen(
  url: string,
  isMainFrame: boolean,
  base: string | null,
): string | null {
  if (!isMainFrame || isInboxUrl(url, base)) return null;
  return /^https:\/\//i.test(url) || /^mailto:/i.test(url) ? url : null;
}

/**
 * Both permission requests and synchronous checks use the requesting frame, not just its parent.
 * `media` (voice notes) is the microphone only: any camera or unknown media type is refused.
 */
export function inboxPermissionAllowed(
  permission: string,
  currentUrl: string,
  requestingUrl: string,
  isMainFrame: boolean,
  base: string | null,
  mediaTypes: readonly string[] = [],
): boolean {
  if (!isMainFrame || !isInboxUrl(currentUrl, base) || !isInboxUrl(requestingUrl, base))
    return false;
  if (permission === 'media')
    return mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');
  return ['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission);
}
