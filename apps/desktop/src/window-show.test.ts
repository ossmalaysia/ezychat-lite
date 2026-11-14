import { describe, expect, it } from 'vitest';
import { showWindow } from './window-show.js';

/** A window like Windows makes it for a process started hidden: the first show() is swallowed. */
function fakeWindow(startedHidden: boolean) {
  let visible = false;
  let shows = 0;
  return {
    show() {
      shows++;
      if (!(startedHidden && shows === 1)) visible = true;
    },
    isVisible: () => visible,
    get shows() {
      return shows;
    },
  };
}

describe('showWindow', () => {
  it('shows a normally started window with one call', () => {
    const win = fakeWindow(false);
    showWindow(win);
    expect(win.isVisible()).toBe(true);
    expect(win.shows).toBe(1);
  });

  it('shows again when the app was started hidden (the updater relaunch), so the window appears', () => {
    const win = fakeWindow(true);
    showWindow(win);
    expect(win.isVisible()).toBe(true);
    expect(win.shows).toBe(2);
  });
});
