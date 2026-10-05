import { describe, expect, it } from 'vitest';
import { APP_NAME, appTitle } from './app-title.js';

describe('appTitle', () => {
  it('appends the version', () => {
    expect(appTitle('0.1.0')).toBe('EzyChat Lite v0.1.0');
  });
  it('does not double a leading v', () => {
    expect(appTitle('v1.2.3')).toBe('EzyChat Lite v1.2.3');
  });
  it('falls back to the bare name when the version is unknown', () => {
    expect(appTitle('')).toBe(APP_NAME);
    expect(appTitle(null)).toBe(APP_NAME);
    expect(appTitle(undefined)).toBe(APP_NAME);
  });
  it('marks unpackaged (local) builds as Dev Build', () => {
    expect(appTitle('0.1.20', { devBuild: true })).toBe('EzyChat Lite v0.1.20 · Dev Build');
    expect(appTitle(null, { devBuild: true })).toBe('EzyChat Lite · Dev Build');
    expect(appTitle('0.1.20', { devBuild: false })).toBe('EzyChat Lite v0.1.20');
  });
});
