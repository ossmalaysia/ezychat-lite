import { describe, expect, it } from 'vitest';
import { closeAction } from './window-close.js';

describe('closeAction', () => {
  it('keeps a service client in the tray by default and quits when the user opts out', () => {
    expect(closeAction('client', true)).toBe('hide');
    expect(closeAction('client', false)).toBe('quit');
  });

  it('never quits a window whose app hosts or is still starting the server', () => {
    for (const mode of ['standalone', 'starting', 'error'] as const) {
      expect(closeAction(mode, true)).toBe('hide');
      expect(closeAction(mode, false)).toBe('hide');
    }
  });
});
