import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_USER_MODEL_ID, appUserModelId } from './app-identity.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('appUserModelId', () => {
  it('matches the installer appId for the packaged app (its shortcuts carry it)', () => {
    const builder = readFileSync(join(here, '..', 'electron-builder.yml'), 'utf8');
    expect(builder).toMatch(new RegExp(`^appId: ${APP_USER_MODEL_ID.replace(/\./g, '\\.')}$`, 'm'));
    expect(appUserModelId(true)).toBe(APP_USER_MODEL_ID);
  });

  it('gives unpackaged dev runs their own id so they never take over the installed taskbar icon', () => {
    expect(appUserModelId(false)).toBe(`${APP_USER_MODEL_ID}.dev`);
  });
});
