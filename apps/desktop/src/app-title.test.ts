import { describe, expect, it } from 'vitest';
import { APP_NAME, appTitle } from './app-title.js';

describe('appTitle', () => {
  it('appends the version', () => {
    expect(appTitle('0.1.0')).toBe('WA Team Inbox v0.1.0');
  });
  it('does not double a leading v', () => {
    expect(appTitle('v1.2.3')).toBe('WA Team Inbox v1.2.3');
  });
  it('falls back to the bare name when the version is unknown', () => {
    expect(appTitle('')).toBe(APP_NAME);
    expect(appTitle(null)).toBe(APP_NAME);
    expect(appTitle(undefined)).toBe(APP_NAME);
  });
});
