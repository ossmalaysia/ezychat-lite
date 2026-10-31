import { describe, expect, it } from 'vitest';
import { parseWorkbook, setStage } from '../build-summary.mjs';
import { loadMap } from './components.mjs';
import {
  ciLinkCheck,
  coverageFromLog,
  devBuildEvidence,
  devBuildRows,
  ownChanges,
  ownDiffChanges,
  requiredChecks,
  resetsEvidence,
  reviewCommentCounts,
  workbookEvidence,
} from './evidence.mjs';

const map = loadMap('docs/release-review/components.json');

describe("the PR's own diff", () => {
  const d = (path, body, head = 'index 1..2 100644') =>
    `diff --git a/${path} b/${path}\n${head}\n--- a/${path}\n+++ b/${path}\n${body}\n`;
  it('ignores hunk positions and neutral files, so a merge of main keeps evidence', () => {
    const before = d('apps/web/src/App.tsx', '@@ -3 +3,2 @@\n+b');
    const after =
      d('apps/web/src/App.tsx', '@@ -9 +9,2 @@\n+b', 'index 7..8 100644') +
      d('docs/workbooks/feat__x.md', '+row') +
      d('docs/dev-build-checks.md', '+row');
    expect(ownDiffChanges(before, after, map)).toEqual([]);
  });
  it('lists the non-neutral files whose own change differs, was added or dropped', () => {
    const before = d('apps/web/src/App.tsx', '+b') + d('packages/server/src/old.ts', '+o');
    const after = d('apps/web/src/App.tsx', '+c\n-a') + d('e2e/x.spec.ts', '+t');
    expect(ownDiffChanges(before, after, map)).toEqual([
      'apps/web/src/App.tsx',
      'e2e/x.spec.ts',
      'packages/server/src/old.ts',
    ]);
  });
  it('only code, pipeline and test files reset evidence; docs and mocks do not', () => {
    const docs = ['AGENTS.md', 'CHANGELOG.md', 'docs/features/x/mock/src/App.tsx', 'docs/x.md'];
    expect(docs.filter((path) => resetsEvidence(map, path))).toEqual([]);
    const tested = [
      'packages/server/src/a.ts',
      'packages/server/test/a.test.ts',
      'e2e/a.spec.ts',
      '.github/workflows/ci.yml',
    ];
    expect(tested.filter((path) => resetsEvidence(map, path))).toEqual(tested);
    expect(resetsEvidence(map, 'docs/workbooks/x.md')).toBe(false);
  });
  it('tells a new file from a changed one and keys binary files by their blobs', () => {
    expect(ownChanges(d('x.ts', '+a', 'new file mode 100644\nindex 0..1')).get('x.ts')).toBe(
      'new file mode 100644\n+a',
    );
    const bin = (index) =>
      `diff --git a/apps/web/public/x.png b/apps/web/public/x.png\nindex ${index} 100644\nBinary files a/apps/web/public/x.png and b/apps/web/public/x.png differ\n`;
    expect(ownDiffChanges(bin('1..2'), bin('1..2'), map)).toEqual([]);
    expect(ownDiffChanges(bin('1..2'), bin('1..3'), map)).toEqual(['apps/web/public/x.png']);
  });
  it('is unknown without a diff', () => {
    expect(ownDiffChanges(null, '', map)).toBeNull();
    expect(ownDiffChanges('', '', map)).toEqual([]);
  });
});

describe('required checks', () => {
  const run = (name, status, conclusion, started_at = '2026-10-30T01:00:00Z', id = 1) => ({
    name,
    status,
    conclusion,
    started_at,
    id,
  });
  it('is green only when every named check passed; the newest run of a name decides', () => {
    const runs = [
      run('A', 'completed', 'failure', '2026-10-30T01:00:00Z', 1),
      run('A', 'completed', 'success', '2026-10-30T02:00:00Z', 2),
      run('B', 'completed', 'skipped'),
      run('Other', 'completed', 'failure'),
    ];
    expect(requiredChecks(runs, ['A', 'B'])).toEqual({
      state: 'green',
      missing: [],
      pending: [],
      failed: [],
    });
    expect(requiredChecks(runs, ['A', 'B', 'C'])).toMatchObject({
      state: 'pending',
      missing: ['C'],
    });
    expect(requiredChecks([run('A', 'queued', null)], ['A'])).toMatchObject({
      state: 'pending',
      pending: ['A'],
    });
    expect(
      requiredChecks([run('A', 'completed', 'cancelled'), run('B', 'queued', null)], ['A', 'B']),
    ).toMatchObject({ state: 'failed', failed: ['A'], pending: ['B'] });
  });
});

describe('workbook evidence', () => {
  const meta = { title: 'X', branch: 'feat/x' };
  let md = setStage(
    null,
    meta,
    'E2E',
    'pass',
    'npm run e2e 83 passed; e2e:electron-links 15/15',
    'd',
    'aaa1111',
  );
  md = setStage(md, meta, 'Screen review', 'skip', 'not needed', 'd', 'aaa1111');
  const book = parseWorkbook(md);

  it('needs a valid commit and a done/pass status', () => {
    const ev = workbookEvidence(book, (sha) => sha === 'aaa1111');
    expect(ev.e2e.ok).toBe(true);
    // The link check is read from CI only.
    expect(ev.linkCheck).toBeUndefined();
    expect(ev.screenReview.ok).toBe(false);
    expect(workbookEvidence(book, () => false).e2e.ok).toBe(false);
  });
  it('no workbook means no evidence', () => {
    expect(workbookEvidence(null, () => true).e2e.ok).toBe(false);
  });
});

describe('Dev Build log', () => {
  const log = [
    '| Date | Build / PR | Scenario | Steps | Result | Not covered |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 2026-10-24 | `feat/upgrade-enterprise` (`10663f8`) | Links | x | 40 screens | y |',
    '| 2026-10-23 | `feat/emoji-reactions` (`016104f`) | real: WhatsApp reactions | x | 58 stored | y |',
  ].join('\n');

  it('finds the commits and the real: marker', () => {
    const rows = devBuildRows(log);
    expect(rows.map((r) => r.shas)).toEqual([['10663f8'], ['016104f']]);
    expect(rows.map((r) => r.real)).toEqual([false, true]);
  });
  it('counts only rows for a valid commit', () => {
    const rows = devBuildRows(log);
    expect(devBuildEvidence(rows, (s) => s === '10663f8')).toEqual({
      devBuild: true,
      realTest: false,
    });
    expect(devBuildEvidence(rows, (s) => s === '016104f')).toEqual({
      devBuild: true,
      realTest: true,
    });
    expect(devBuildEvidence(rows, () => false)).toEqual({ devBuild: false, realTest: false });
  });
});

describe('coverage line', () => {
  it('reads the CI percentage', () => {
    expect(coverageFromLog('x\nchanged-lines coverage: 93.4 % (12/13 lines, minimum 90 %)\n')).toBe(
      93.4,
    );
    expect(coverageFromLog('changed-lines coverage: no changed executable lines')).toBe(100);
    expect(coverageFromLog('nothing here')).toBeNull();
  });
});

describe('CI evidence', () => {
  const step = (name, conclusion) => ({ name, conclusion });
  it('counts the link check only when the e2e:electron-links step passed', () => {
    const job = (conclusion) => ({
      steps: [step('Run npm test', 'success'), step('Run npm run e2e:electron-links', conclusion)],
    });
    expect(ciLinkCheck(job('success'))).toBe(true);
    expect(ciLinkCheck(job('failure'))).toBe(false);
    // Skipped on a docs-only run: the job is green but the check never ran.
    expect(ciLinkCheck(job('skipped'))).toBe(false);
    expect(ciLinkCheck({ steps: [step('Run npm test', 'success')] })).toBe(false);
    expect(ciLinkCheck(null)).toBe(false);
  });

  it('counts review comments and the unresolved threads', () => {
    const comments = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(reviewCommentCounts(comments, [{ isResolved: true }, { isResolved: false }])).toEqual({
      total: 3,
      open: 1,
    });
    expect(reviewCommentCounts(comments, null)).toEqual({ total: 3, open: null });
    expect(reviewCommentCounts(comments, [{ is_resolved: true }, { resolved: false }])).toEqual({
      total: 3,
      open: 1,
    });
    // A thread without a resolved flag makes the whole count unknown, never "0 open".
    expect(reviewCommentCounts(comments, [{ isResolved: true }, { id: 9 }])).toEqual({
      total: 3,
      open: null,
    });
    expect(reviewCommentCounts([], [])).toEqual({ total: 0, open: 0 });
  });
});
