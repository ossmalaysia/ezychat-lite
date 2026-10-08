import { describe, expect, it } from 'vitest';
import {
  ciSummary,
  devBuildSummary,
  overviewRows,
  paint,
  parseWorkbook,
  renderFeature,
  renderMerged,
  setStage,
  STAGES,
} from './build-summary.mjs';

const LOG = [
  '| Date | Build / PR | Scenario | Steps | Result | Not covered |',
  '| --- | --- | --- | --- | --- | --- |',
  '| 2026-10-08 | feat/ai-edit-instructions (Edit with AI) | Edit rules | … | Pass. Added a line. | — |',
  '| 2026-10-08 | same | Instructions | … | Pass. 2 lines changed. | — |',
  '| 2026-10-08 | spike/ai-sdk-agent, before the fix | Fact | … | **Fail** 2 of 3: HTTP 404 | — |',
  '| 2026-10-07 | 0.1.23 + #42 (AI customer details) | Details | … | Pass. | — |',
].join('\n');

describe('devBuildSummary', () => {
  it('counts the rows of a feature by branch, following "same" rows', () => {
    expect(devBuildSummary(LOG, { number: 47, branch: 'feat/ai-edit-instructions' })).toEqual({
      pass: 2,
      fail: 0,
    });
  });

  it('matches a PR number and counts failures', () => {
    expect(devBuildSummary(LOG, { number: 42, branch: 'feat/ai-customer-details' })).toEqual({
      pass: 1,
      fail: 0,
    });
    expect(devBuildSummary(LOG, { number: 45, branch: 'spike/ai-sdk-agent' })).toEqual({
      pass: 0,
      fail: 1,
    });
  });

  it('returns nothing for a feature without Dev Build checks', () => {
    expect(devBuildSummary(LOG, { number: 9, branch: 'feat/other' })).toEqual({ pass: 0, fail: 0 });
  });
});

describe('ciSummary', () => {
  it('splits the unit-test jobs per OS from SonarCloud', () => {
    expect(
      ciSummary([
        { name: 'Test (ubuntu-latest)', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'Test (windows-latest)', status: 'IN_PROGRESS', conclusion: null },
        { name: 'Test (macos-latest)', status: 'COMPLETED', conclusion: 'FAILURE' },
        { name: 'SonarCloud Code Analysis', status: 'COMPLETED', conclusion: 'SUCCESS' },
      ]),
    ).toEqual({
      unit: { ubuntu: 'pass', windows: 'running', macos: 'fail' },
      quality: 'pass',
    });
  });
});

describe('workbook', () => {
  it('starts a new workbook with every stage open, then records one', () => {
    const md = setStage(
      null,
      { title: 'Edit with AI', branch: 'feat/x' },
      'E2E',
      'pass',
      '50 passed',
      '2026-10-08',
    );
    expect(md).toContain('# Workbook: Edit with AI');
    expect(md).toContain('Branch: `feat/x`');
    const book = parseWorkbook(md);
    expect(Object.keys(book.stages)).toEqual(STAGES);
    expect(book.stages.E2E).toEqual({ status: 'pass', detail: '50 passed', updated: '2026-10-08' });
    expect(book.stages.Design).toEqual({ status: 'todo', detail: '', updated: '' });
    expect(md).toMatch(/## Log\n\n- 2026-10-08 E2E: pass — 50 passed/);
  });

  it('updates a stage in place and keeps the rest and the log', () => {
    let md = setStage(
      null,
      { title: 'X', branch: 'feat/x' },
      'Dev',
      'doing',
      'server done',
      '2026-10-07',
    );
    md = setStage(md, { title: 'X', branch: 'feat/x' }, 'Dev', 'done', 'web done', '2026-10-08');
    const book = parseWorkbook(md);
    expect(book.stages.Dev).toEqual({ status: 'done', detail: 'web done', updated: '2026-10-08' });
    expect(md.match(/\| Dev \|/g)).toHaveLength(1);
    expect(md).toContain('- 2026-10-07 Dev: doing — server done');
    expect(md).toContain('- 2026-10-08 Dev: done — web done');
  });

  it('rejects unknown stages and statuses', () => {
    expect(() => setStage(null, { title: 'X', branch: 'b' }, 'Coffee', 'done', 'x', 'd')).toThrow();
    expect(() => setStage(null, { title: 'X', branch: 'b' }, 'Dev', 'great', 'x', 'd')).toThrow();
  });
});

describe('renderFeature', () => {
  const book = (stages) => ({ stages });

  it('shows one line per stage, ending with whether it can merge', () => {
    const text = renderFeature({
      number: 47,
      title: 'feat(ai): Edit with AI',
      branch: 'feat/ai-edit-instructions',
      state: 'OPEN',
      isDraft: false,
      commits: 4,
      ci: { unit: { ubuntu: 'pass', windows: 'pass', macos: 'pass' }, quality: 'pass' },
      workbook: book({
        Design: { status: 'done', detail: 'mockup approved', updated: '2026-10-08' },
        E2E: { status: 'pass', detail: '50 passed', updated: '2026-10-08' },
        'Screen review': { status: 'done', detail: '8 findings fixed', updated: '2026-10-08' },
      }),
      devBuild: { pass: 3, fail: 0 },
      openComments: 0,
      mergeState: 'CLEAN',
    });
    expect(text).toContain('#47');
    expect(text).toMatch(/Design\s+✓ mockup approved/);
    expect(text).toMatch(/Unit tests\s+✓ CI ubuntu ✓ windows ✓ macos ✓/);
    expect(text).toMatch(/E2E\s+✓ 50 passed/);
    expect(text).toMatch(/Dev Build\s+✓ 3 checks passed/);
    expect(text).toMatch(/Screen review\s+✓ 8 findings fixed/);
    expect(text).toMatch(/Mergeable\s+✓ ready to merge/);
  });

  it('says what is missing instead of a tick', () => {
    const text = renderFeature({
      number: 48,
      title: 'feat: something',
      branch: 'feat/x',
      state: 'OPEN',
      isDraft: true,
      commits: 1,
      ci: { unit: {}, quality: null },
      workbook: null,
      devBuild: { pass: 0, fail: 0 },
      openComments: 2,
      mergeState: 'BLOCKED',
    });
    expect(text).toMatch(/Dev\s+◐ draft PR/);
    expect(text).toMatch(/Workbook\s+✗ missing: docs\/workbooks\/feat__x\.md/);
    expect(text).toMatch(/E2E\s+· not recorded/);
    expect(text).toMatch(/Dev Build\s+· no checks logged/);
    expect(text).toMatch(/Review\s+✗ 2 open comments/);
    expect(text).toMatch(/Mergeable\s+✗ blocked/);
  });

  it('uses the singular for one comment and explains an unknown merge state', () => {
    const text = renderFeature({
      number: 49,
      title: 'docs: x',
      branch: 'docs/x',
      state: 'OPEN',
      isDraft: false,
      commits: 1,
      ci: { unit: {}, quality: null },
      workbook: book({}),
      devBuild: { pass: 0, fail: 0 },
      openComments: 1,
      mergeState: 'UNKNOWN',
    });
    expect(text).toMatch(/Review\s+✗ 1 open comment$/m);
    expect(text).toMatch(/Dev\s+● PR open, ready for review, 1 commit$/m);
    expect(text).toMatch(/Mergeable\s+· GitHub is still checking/);
  });
});

describe('display', () => {
  const ESC = String.fromCharCode(27);
  const ready = {
    number: 47,
    title: 'feat(ai): Edit with AI for the AI instructions and hand-off rules',
    branch: 'feat/ai-edit-instructions',
    state: 'OPEN',
    isDraft: false,
    commits: 5,
    ci: { unit: { ubuntu: 'pass', windows: 'pass', macos: 'pass' }, quality: 'pass' },
    workbook: {
      stages: {
        Design: { status: 'done', detail: 'x', updated: '' },
        Dev: { status: 'done', detail: 'x', updated: '' },
        E2E: { status: 'pass', detail: 'x', updated: '' },
        'Dev Build': { status: 'pass', detail: 'x', updated: '' },
        'Screen review': { status: 'skip', detail: 'x', updated: '' },
      },
    },
    devBuild: { pass: 0, fail: 0 },
    openComments: 0,
    mergeState: 'CLEAN',
  };
  const running = {
    ...ready,
    number: 48,
    title: 'feat(tooling): build summary',
    ci: { unit: { ubuntu: 'running' }, quality: null },
    workbook: null,
    openComments: 2,
    mergeState: 'BLOCKED',
  };

  it('draws every open feature as one row of a bordered table, one mark per stage', () => {
    const lines = overviewRows([ready, running], 120);
    const cells = (line) =>
      line
        .split('│')
        .slice(1, -1)
        .map((cell) => cell.trim());
    expect(lines[0]).toMatch(/^┌─+┬.*┐$/);
    expect(cells(lines[1])).toEqual([
      'PR',
      'Feature',
      'Design',
      'Dev',
      'Unit',
      'Qual',
      'E2E',
      'DevB',
      'Screen',
      'Review',
      'Merge',
    ]);
    expect(lines[2]).toMatch(/^├─+┼.*┤$/);
    const [first, second] = [cells(lines[3]), cells(lines[4])];
    expect(first[0]).toBe('#47');
    expect(first[1]).toMatch(/^feat\(ai\): Edit with AI.*…$/); // shortened to fit
    expect(first.slice(2)).toEqual(['✓', '✓', '✓', '✓', '✓', '✓', '–', '✓', '✓ ready']);
    expect(second.slice(2)).toEqual(['·', '·', '…', '·', '·', '·', '·', '✗ 2', '✗ blocked']);
    expect(lines.at(-1)).toMatch(/^└─+┴.*┘$/);
    // Every line has the same width and fits the terminal.
    expect(new Set(lines.map((line) => [...line].length)).size).toBe(1);
    expect([...lines[0]].length).toBeLessThanOrEqual(120);
  });

  it('collapses merged features to one line each', () => {
    expect(
      renderMerged({
        number: 46,
        title: 'chore(release): 0.1.25',
        mergedAt: '2026-10-08T01:00:00Z',
      }),
    ).toBe('✓ #46  chore(release): 0.1.25  merged 2026-10-08');
  });

  it('colours marks only when asked: green done, red problem, yellow in progress, grey not yet', () => {
    expect(paint('✓ ready', false)).toBe('✓ ready');
    expect(paint('✓ ready', true)).toBe(`${ESC}[32m✓${ESC}[39m ready`);
    expect(paint('✗ 2', true)).toContain(`${ESC}[31m✗`);
    expect(paint('… CI', true)).toContain(`${ESC}[33m…`);
    expect(paint('· not yet', true)).toContain(`${ESC}[90m·`);
    expect(renderFeature(ready)).not.toContain(`${ESC}[`);
  });
});
