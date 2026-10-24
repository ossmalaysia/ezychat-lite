import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SHARED_LOG,
  appendEntry,
  appendIndexRow,
  indexRow,
  logPathFor,
  parseIndex,
  renderApproval,
  renderEntry,
} from './log.mjs';

const result = {
  score: 75,
  decision: 'risk:auto',
  tier: 'noncore',
  tierFiles: ['apps/web/src/admin/MembersPage.tsx'],
  countedLines: 600,
  items: [
    { label: 'Tier: noncore', points: -5, ok: true },
    { label: 'e2e covers the change', points: 0, ok: false },
  ],
  hardStops: [],
};

describe('review log', () => {
  it('an entry lists every item with its proof', () => {
    const md = renderEntry({ date: '2026-10-24', pr: 162, sha: 'abc1234', result });
    expect(md).toContain('## 2026-10-24 · PR #162 · `abc1234` · risk:auto (75)');
    expect(md).toContain('| Tier: noncore | -5 | ✓ |');
    expect(md).toContain('| e2e covers the change | 0 | ✗ missing |');
    expect(md).toContain('Hard stops: none');
  });
  it('a docs-only entry says so, and hard stops are listed', () => {
    const md = renderEntry({
      date: 'd',
      pr: 1,
      sha: 's',
      result: { ...result, items: [], hardStops: [{ id: 4, reason: 'checks pending' }] },
      migrationNote: 'x.sql — adds-only',
    });
    expect(md).toContain('Only docs, tests or pipeline files changed.');
    expect(md).toContain('Hard stops: 4. checks pending');
    expect(md).toContain('Migration: x.sql — adds-only');
  });
  it('an approval quotes the owner', () => {
    expect(renderApproval({ date: 'd', pr: 159, sha: 's', quote: 'tested ok' })).toContain(
      '> tested ok',
    );
  });
  it('an index row reads back', () => {
    const row = indexRow({
      date: '2026-10-24',
      pr: 162,
      sha: 'abc1234',
      tier: 'noncore',
      score: 75,
      decision: 'risk:auto',
      logPath: SHARED_LOG,
    });
    expect(parseIndex(`x\n${row}\n`)).toEqual([
      {
        date: '2026-10-24',
        pr: 162,
        sha: 'abc1234',
        tier: 'noncore',
        score: 75,
        decision: 'risk:auto',
        logPath: SHARED_LOG,
      },
    ]);
  });
});

describe('log location', () => {
  const featureFolders = ['upgrade-enterprise', 'send-reactions'];
  it('prefers the Feature line, then the branch name, then the shared log', () => {
    expect(
      logPathFor({
        workbookMarkdown: 'Feature: send-reactions\n',
        branch: 'feat/other',
        featureFolders,
      }),
    ).toBe('docs/features/send-reactions/review.md');
    expect(
      logPathFor({ workbookMarkdown: null, branch: 'feat/upgrade-enterprise', featureFolders }),
    ).toBe('docs/features/upgrade-enterprise/review.md');
    expect(logPathFor({ workbookMarkdown: null, branch: 'fix/typo', featureFolders })).toBe(
      SHARED_LOG,
    );
  });
});

describe('append only', () => {
  it('never rewrites old entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rr-'));
    const path = join(dir, 'review.md');
    appendEntry(path, '## one');
    appendEntry(path, '## two');
    expect(readFileSync(path, 'utf8')).toBe('# Review log\n\n## one\n\n## two\n');
    const index = join(dir, 'index.md');
    appendIndexRow(index, '| a |');
    appendIndexRow(index, '| b |');
    const text = readFileSync(index, 'utf8');
    expect(text).toContain('| Date | PR | Commit |');
    expect(text.trimEnd().endsWith('| a |\n| b |')).toBe(true);
    writeFileSync(path, '# Review log\n\n## kept\n');
    appendEntry(path, '## three');
    expect(readFileSync(path, 'utf8')).toContain('## kept\n\n## three');
  });
});
