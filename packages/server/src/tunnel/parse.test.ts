import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cloudflaredBinaryName, resolveCloudflaredPath } from './binary.js';
import { parseQuickTunnelUrl } from './parse.js';

describe('parseQuickTunnelUrl', () => {
  it('extracts the URL from the cloudflared banner line', () => {
    expect(parseQuickTunnelUrl('2024-01-01T00:00:00Z INF |  https://abc-def.trycloudflare.com  |')).toBe(
      'https://abc-def.trycloudflare.com',
    );
  });
  it('returns null for unrelated lines', () => {
    expect(parseQuickTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeNull();
    expect(parseQuickTunnelUrl('https://api.trycloudflare.com/tunnel')).toBeNull();
    expect(parseQuickTunnelUrl('')).toBeNull();
  });
});

describe('resolveCloudflaredPath', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'wati-cf-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('prefers WATI_CLOUDFLARED env', () => {
    const d = tmp();
    const f = join(d, 'my-cf');
    writeFileSync(f, '');
    expect(resolveCloudflaredPath({ WATI_CLOUDFLARED: f, PATH: '' })).toBe(f);
  });

  it('uses resourcesDir/cloudflared/<platform>-<arch>/', () => {
    const res = tmp();
    const sub = join(res, 'cloudflared', `${process.platform}-${process.arch}`);
    mkdirSync(sub, { recursive: true });
    const f = join(sub, cloudflaredBinaryName());
    writeFileSync(f, '');
    expect(resolveCloudflaredPath({ PATH: '' }, res)).toBe(f);
  });

  it('falls back to PATH lookup', () => {
    const d = tmp();
    const f = join(d, cloudflaredBinaryName());
    writeFileSync(f, '');
    expect(resolveCloudflaredPath({ PATH: d })).toBe(f);
  });

  it('returns null when not found anywhere', () => {
    const d = tmp();
    expect(resolveCloudflaredPath({ PATH: d }, d)).toBeNull();
  });
});
