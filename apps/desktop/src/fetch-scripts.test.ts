// The fetch scripts ship as bins of @ezychat/desktop: another edition passes --out <its resources>.
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script without type declarations
import { parseArgs as cloudflaredArgs } from '../scripts/fetch-cloudflared.mjs';
// @ts-expect-error plain .mjs build script without type declarations
import { parseArgs as winswArgs } from '../scripts/fetch-winsw.mjs';

const repoResources = resolve(__dirname, '..', '..', '..', 'resources');

describe('fetch-cloudflared arguments', () => {
  it('defaults to the repository resources folder and the three installer targets', () => {
    expect(cloudflaredArgs([])).toEqual({
      targets: ['win32-x64', 'darwin-x64', 'darwin-arm64'],
      force: false,
      resources: repoResources,
    });
  });

  it('takes --out and --target', () => {
    const out = resolve('ent', 'resources');
    expect(cloudflaredArgs(['--out', out, '--target', 'win32-x64'])).toMatchObject({
      targets: ['win32-x64'],
      resources: out,
    });
    expect(cloudflaredArgs([`--out=${out}`]).resources).toBe(out);
  });

  it('refuses unknown arguments', () => {
    expect(() => cloudflaredArgs(['--outdir', 'x'])).toThrow('unknown argument --outdir');
  });
});

describe('fetch-winsw arguments', () => {
  it('writes WinSW-x64.exe under <resources>/winsw', () => {
    expect(winswArgs([])).toEqual({
      force: false,
      out: join(repoResources, 'winsw', 'WinSW-x64.exe'),
    });
    const out = resolve('ent', 'resources');
    expect(winswArgs(['--force', '--out', out])).toEqual({
      force: true,
      out: join(out, 'winsw', 'WinSW-x64.exe'),
    });
  });

  it('refuses unknown arguments', () => {
    expect(() => winswArgs(['--target', 'x'])).toThrow('unknown argument --target');
  });
});
