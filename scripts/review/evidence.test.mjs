import { describe, expect, it } from 'vitest';
import { parseWorkbook, setStage } from '../build-summary.mjs';
import { loadMap } from './components.mjs';
import {
  ciLinkCheck,
  coverageFromLog,
  devBuildEvidence,
  devBuildRows,
  evidenceShaValid,
  reviewCommentCounts,
  workbookEvidence,
} from './evidence.mjs';

const map = loadMap('docs/release-review/components.json');

describe('evidence commit', () => {
  it('stale evidence after a code commit does not count', () => {
    const since = () => ['docs/workbooks/feat__x.md', 'apps/web/src/App.tsx'];
    expect(evidenceShaValid('abc1234', since, map)).toBe(false);
  });
  it('evidence survives a workbook-only commit', () => {
    const since = () => ['docs/workbooks/feat__x.md', 'docs/dev-build-checks.md'];
    expect(evidenceShaValid('abc1234', since, map)).toBe(true);
  });
  it('no commit or an unknown commit does not count', () => {
    expect(evidenceShaValid('', () => [], map)).toBe(false);
    expect(evidenceShaValid('abc1234', () => null, map)).toBe(false);
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
    expect(ev.linkCheck.ok).toBe(true);
    expect(ev.screenReview.ok).toBe(false);
    expect(workbookEvidence(book, () => false).e2e.ok).toBe(false);
  });
  it('the link check needs electron-links in the E2E detail', () => {
    const plain = parseWorkbook(setStage(null, meta, 'E2E', 'pass', '83 passed', 'd', 'aaa1111'));
    expect(workbookEvidence(plain, () => true).linkCheck.ok).toBe(false);
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
    expect(reviewCommentCounts([], [])).toEqual({ total: 0, open: 0 });
  });
});
