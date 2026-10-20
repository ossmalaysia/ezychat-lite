import { describe, expect, it } from 'vitest';
import {
  changedCoverage,
  changedLines,
  isSourceFile,
  missingSourceFiles,
} from './changed-lines-coverage.mjs';

const diff = [
  'diff --git a/packages/x/src/a.ts b/packages/x/src/a.ts',
  '--- a/packages/x/src/a.ts',
  '+++ b/packages/x/src/a.ts',
  '@@ -3,0 +4,3 @@ export function a() {',
  '+  one();',
  '+  two();',
  '+  // note',
  '@@ -20 +23 @@',
  '+  three();',
  'diff --git a/docs/x.md b/docs/x.md',
  '--- a/docs/x.md',
  '+++ b/docs/x.md',
  '@@ -1 +1 @@',
  '+text',
  'diff --git a/old.ts b/old.ts',
  '--- a/old.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
].join('\n');

describe('changed-lines coverage', () => {
  it('reads added and changed lines per file, not deleted files', () => {
    const lines = changedLines(diff);
    expect([...lines.get('packages/x/src/a.ts')]).toEqual([4, 5, 6, 23]);
    expect(lines.has('old.ts')).toBe(false);
  });

  it('counts only changed lines where a statement starts, covered or not', () => {
    const coverage = {
      'packages/x/src/a.ts': {
        statementMap: {
          0: { start: { line: 4 } },
          1: { start: { line: 5 } },
          2: { start: { line: 23 } },
          3: { start: { line: 40 } },
        },
        s: { 0: 3, 1: 0, 2: 1, 3: 0 },
      },
    };
    expect(changedCoverage(changedLines(diff), coverage)).toEqual({
      covered: ['packages/x/src/a.ts:4', 'packages/x/src/a.ts:23'],
      uncovered: ['packages/x/src/a.ts:5'],
    });
  });

  it('ignores files outside the coverage report (docs, tests, configs)', () => {
    expect(changedCoverage(changedLines(diff), {})).toEqual({ covered: [], uncovered: [] });
  });

  it('knows which files are source the gate must measure', () => {
    expect(isSourceFile('packages/server/src/mcp/send.ts')).toBe(true);
    expect(isSourceFile('apps/web/src/admin/Page.tsx')).toBe(true);
    expect(isSourceFile('apps/desktop/src/inbox-preload.cts')).toBe(true);
    for (const f of [
      'packages/server/test/mcp.test.ts',
      'apps/web/src/admin/Page.test.tsx',
      'packages/shared/src/types.d.ts',
      'apps/desktop/src/locales/en.json',
      'docs/x.md',
      'scripts/a.mjs',
    ])
      expect(isSourceFile(f), f).toBe(false);
  });

  it('a changed source file missing from the report fails instead of passing unmeasured', () => {
    expect(missingSourceFiles(changedLines(diff), {})).toEqual(['packages/x/src/a.ts']);
    expect(
      missingSourceFiles(changedLines(diff), {
        'packages/x/src/a.ts': { statementMap: {}, s: {} },
      }),
    ).toEqual([]);
  });
});
