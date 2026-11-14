/**
 * Shows a window the user must see. Windows gives a process started hidden (`Start-Process -WindowStyle Hidden`,
 * `windowsHide`) its first window show as hidden too: the first `show()` leaves it invisible and a second one works.
 * The updater of earlier versions relaunches the app that way, so the new app shows again when the first did nothing.
 */
export function showWindow(win: { show(): void; isVisible(): boolean }): void {
  win.show();
  if (!win.isVisible()) win.show();
}
