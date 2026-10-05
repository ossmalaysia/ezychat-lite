// Product name + version strings for the tray, window titles and status page. Pure (no electron).

export const APP_NAME = 'EzyChat Lite';

/** Marks local, unpackaged builds so a test instance is never mistaken for the installed app. */
export const DEV_BUILD_LABEL = 'Dev Build';

/** "EzyChat Lite v1.2.3" (just the name when the version is unknown), "… · Dev Build" for dev builds. */
export function appTitle(
  version: string | null | undefined,
  options: { devBuild?: boolean } = {},
): string {
  const v = (version ?? '').trim().replace(/^v/i, '');
  const title = v ? `${APP_NAME} v${v}` : APP_NAME;
  return options.devBuild ? `${title} · ${DEV_BUILD_LABEL}` : title;
}
