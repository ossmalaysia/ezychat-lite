/** Windows AppUserModelID of the installed app; the installer's shortcuts carry the same id. */
export const APP_USER_MODEL_ID = 'org.ossmalaysia.wateaminbox';

/**
 * Unpackaged (dev, test harness) runs use their own id. Windows ties a taskbar button to the Start
 * Menu shortcut with the window's id; a dev run registered under the installed id once left an
 * "Electron.lnk" pointing at a deleted electron.exe, and the installed app then showed a blank icon.
 */
export function appUserModelId(isPackaged: boolean): string {
  return isPackaged ? APP_USER_MODEL_ID : `${APP_USER_MODEL_ID}.dev`;
}
