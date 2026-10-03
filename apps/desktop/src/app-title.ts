// Product name + version strings for the tray, window titles and status page. Pure (no electron).

export const APP_NAME = 'WA Team Inbox';

/** "WA Team Inbox v1.2.3" (just the name when the version is unknown). */
export function appTitle(version: string | null | undefined): string {
  const v = (version ?? '').trim().replace(/^v/i, '');
  return v ? `${APP_NAME} v${v}` : APP_NAME;
}
