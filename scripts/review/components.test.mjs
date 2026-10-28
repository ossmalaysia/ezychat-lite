import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolveTool } from '../build-summary.mjs';
import {
  classifyFile,
  dependencyTier,
  isNeutral,
  isScreenFile,
  loadMap,
  parseMap,
} from './components.mjs';

const map = loadMap('docs/release-review/components.json');
const tier = (path) => classifyFile(map, path).tier;

describe('component map', () => {
  it('puts each part in its tier', () => {
    expect(classifyFile(map, 'packages/wa/src/baileys/adapter.ts')).toMatchObject({
      tier: 'critical',
      realTest: 'real WhatsApp',
    });
    expect(classifyFile(map, 'packages/server/src/http/origin.ts')).toMatchObject({
      tier: 'critical',
      security: true,
    });
    expect(tier('packages/server/src/db/migrations/017_x.sql')).toBe('critical');
    expect(tier('packages/wa/src/fake/adapter.ts')).toBe('noncore');
    expect(tier('apps/web/src/inbox/Composer.tsx')).toBe('core');
    expect(tier('apps/web/src/admin/MembersPage.tsx')).toBe('noncore');
    expect(tier('apps/desktop/src/updater/apply.ts')).toBe('critical');
    expect(tier('docs/release-review/components.json')).toBe('core');
    expect(tier('docs/release.md')).toBe('docs');
    expect(tier('apps/web/src/admin/MembersPage.test.tsx')).toBe('docs');
    expect(tier('.github/workflows/ci.yml')).toBe('pipeline');
    // A manifest inside a critical folder: its dependency changes decide the risk, not the folder.
    expect(classifyFile(map, 'packages/wa/package.json')).toMatchObject({
      tier: 'noncore',
      security: false,
    });
  });

  it('counts an unmapped code file as core and reports it', () => {
    const tiny = parseMap({ components: [{ glob: 'docs/**', tier: 'docs', name: 'Docs' }] });
    expect(classifyFile(tiny, 'packages/server/src/new-thing.ts')).toMatchObject({
      tier: 'core',
      unmapped: true,
    });
    expect(classifyFile(tiny, 'notes.txt')).toMatchObject({ tier: 'docs', unmapped: false });
  });

  it('rejects an unknown tier', () => {
    expect(() => parseMap({ components: [{ glob: '**', tier: 'low', name: 'x' }] })).toThrow(
      'Unknown tier',
    );
  });

  // Classifies every tracked file (~2,800): under 1 s locally, but past the 5 s default on busy
  // macOS and Windows CI runners.
  it('maps every tracked code file', { timeout: 30_000 }, () => {
    const files = execFileSync(resolveTool('git'), ['ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    expect(files.filter((f) => classifyFile(map, f).unmapped)).toEqual([]);
  });

  it('knows screen files and neutral files', () => {
    expect(isScreenFile(map, 'apps/web/src/admin/MembersPage.tsx')).toBe(true);
    expect(isScreenFile(map, 'apps/web/src/admin/MembersPage.test.tsx')).toBe(false);
    expect(isScreenFile(map, 'packages/server/src/app.ts')).toBe(false);
    expect(isNeutral(map, 'docs/workbooks/feat__x.md')).toBe(true);
    expect(isNeutral(map, 'docs/features/x/review.md')).toBe(true);
    expect(isNeutral(map, 'docs/release.md')).toBe(false);
  });
});

describe('dependency changes', () => {
  it('a version-only package.json is not a dependency change', () => {
    expect(
      dependencyTier(
        map,
        { version: '1', dependencies: { a: '1' } },
        { version: '2', dependencies: { a: '1' } },
      ),
    ).toBeNull();
  });
  it('a Baileys bump is critical, another library is core', () => {
    expect(
      dependencyTier(map, { dependencies: { baileys: '6' } }, { dependencies: { baileys: '7' } }),
    ).toBe('critical');
    expect(
      dependencyTier(
        map,
        { devDependencies: { lodash: '1' } },
        { devDependencies: { lodash: '2' } },
      ),
    ).toBe('core');
    expect(dependencyTier(map, {}, { dependencies: { zod: '4' } })).toBe('core');
  });
});
