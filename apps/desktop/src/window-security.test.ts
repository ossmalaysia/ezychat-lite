import { describe, expect, it } from 'vitest';
import { externalLinkToOpen, inboxPermissionAllowed, isInboxUrl } from './window-security.js';

const base = 'http://127.0.0.1:7420';

describe('external links clicked in the main window', () => {
  it('opens mailto: and https: links from the main frame in the OS', () => {
    const mail = 'mailto:sales@anchorsprint.com?subject=Activate%20EzyChat';
    expect(externalLinkToOpen(mail, true, base)).toBe(mail);
    expect(externalLinkToOpen('https://ezychat.ai/help', true, base)).toBe(
      'https://ezychat.ai/help',
    );
  });

  it('never opens inbox pages, frames or other schemes', () => {
    expect(externalLinkToOpen(base + '/chats', true, base)).toBeNull();
    expect(externalLinkToOpen('mailto:x@example.com', false, base)).toBeNull();
    for (const url of [
      'http://evil.example/',
      'file:///C:/x.exe',
      'javascript:alert(1)',
      'ms-settings:',
    ])
      expect(externalLinkToOpen(url, true, base)).toBeNull();
  });
});

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
  it('allows the microphone, never the camera, only in the inbox main frame', () => {
    expect(inboxPermissionAllowed('media', base, base, true, base, ['audio'])).toBe(true);
    expect(inboxPermissionAllowed('media', base, base, true, base, ['video'])).toBe(false);
    expect(inboxPermissionAllowed('media', base, base, true, base, ['audio', 'video'])).toBe(false);
    expect(inboxPermissionAllowed('media', base, base, true, base, ['unknown'])).toBe(false);
    expect(inboxPermissionAllowed('media', base, base, true, base)).toBe(false);
    expect(inboxPermissionAllowed('media', base, base, false, base, ['audio'])).toBe(false);
    expect(
      inboxPermissionAllowed('media', base, 'https://evil.example/', true, base, ['audio']),
    ).toBe(false);
  });

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
