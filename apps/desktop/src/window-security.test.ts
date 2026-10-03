import { describe, expect, it } from 'vitest';
import { inboxPermissionAllowed, isInboxUrl } from './window-security.js';

const base = 'http://127.0.0.1:7420';

describe('inbox document trust', () => {
  it('accepts only the configured loopback origin', () => {
    expect(isInboxUrl(base + '/chats/123', base)).toBe(true);
    for (const url of [
      'file:///tmp/evil.html',
      'data:text/html,evil',
      'https://evil.example/',
      'http://127.0.0.1:7430/',
      'http://user:pass@127.0.0.1:7420/',
      'http://127.0.0.1.evil.example:7420/',
      'invalid',
    ]) {
      expect(isInboxUrl(url, base)).toBe(false);
    }
    expect(isInboxUrl('https://evil.example/', 'https://evil.example/')).toBe(false);
    expect(isInboxUrl(base, null)).toBe(false);
  });
});

describe('inbox permissions', () => {
  it.each(['notifications', 'clipboard-sanitized-write', 'fullscreen'])(
    'allows %s only in the inbox main frame',
    (permission) => {
      expect(inboxPermissionAllowed(permission, base, base, true, base)).toBe(true);
      expect(inboxPermissionAllowed(permission, base, base, false, base)).toBe(false);
      expect(inboxPermissionAllowed(permission, base, 'https://evil.example/', true, base)).toBe(
        false,
      );
      expect(inboxPermissionAllowed(permission, 'file:///tmp/status.html', base, true, base)).toBe(
        false,
      );
    },
  );

  it.each([
    'media',
    'display-capture',
    'geolocation',
    'clipboard-read',
    'usb',
    'serial',
    'openExternal',
    'unknown',
  ])('denies unused %s permission even to the inbox', (permission) => {
    expect(inboxPermissionAllowed(permission, base, base, true, base)).toBe(false);
  });
});
