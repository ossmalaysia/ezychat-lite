import { describe, expect, it } from 'vitest';
import { loadMap } from './review/components.mjs';
import { gatherFacts, main, parseArgs, patchTouches, sectionRange } from './release-review.mjs';

const map = loadMap('docs/release-review/components.json');
const HEAD = 'f'.repeat(40);
const b64 = (text) => Buffer.from(text).toString('base64');

/** A fake `gh` for one PR: answers by the argument shape, like the real CLI. */
function fakeGh({
  title = 'feat: x',
  files,
  checks = [
    {
      name: map.coverageJob ?? 'Test (ubuntu-latest)',
      id: 7,
      status: 'completed',
      conclusion: 'success',
    },
  ],
  contents = {},
  since = {},
  commits = [],
  jobs = {},
  reviewComments = null,
  threads = null,
}) {
  return (args) => {
    const key = args.join(' ');
    if (key.startsWith('repo view')) return 'o/r\n';
    if (key.startsWith('pr view')) {
      const all = {
        title,
        headRefOid: HEAD,
        baseRefOid: 'b'.repeat(40),
        headRefName: 'docs/x',
        state: 'OPEN',
      };
      return JSON.stringify(all);
    }
    if (args[0] === 'api' && args[1] === 'graphql') {
      if (!threads) throw new Error('HTTP 403: GraphQL is not available');
      return JSON.stringify({
        data: { repository: { pullRequest: { reviewThreads: { nodes: threads } } } },
      });
    }
    const path = args[1]?.replace('repos/o/r/', '') ?? '';
    if (path.startsWith('pulls/5/comments')) {
      if (!reviewComments) throw new Error('404');
      return JSON.stringify(reviewComments);
    }
    const job = path.match(/^actions\/jobs\/(\d+)$/)?.[1];
    if (job) return JSON.stringify(jobs[job] ?? { steps: [] });
    const from = path.match(/^compare\/([0-9a-f]+)\.\.\./)?.[1];
    if (from && from in since)
      return JSON.stringify({ files: since[from].map((filename) => ({ filename })) });
    if (path.startsWith('compare/'))
      return JSON.stringify({ merge_base_commit: { sha: 'm'.repeat(40) }, files, commits });
    if (path.startsWith('commits/')) return JSON.stringify({ check_runs: checks });
    if (path.startsWith('actions/jobs/'))
      return 'changed-lines coverage: 96.0 % (24/25 lines, minimum 90 %)';
    if (path.startsWith('contents/')) {
      const name = path.slice('contents/'.length).split('?')[0];
      if (!(name in contents)) throw new Error('404');
      return JSON.stringify(
        Array.isArray(contents[name]) ? contents[name] : { content: b64(contents[name]) },
      );
    }
    throw new Error(`unexpected gh ${key}`);
  };
}

describe('arguments', () => {
  it('reads the PR number and the options', () => {
    expect(parseArgs(['12', '--write', '--migration', 'adds-only'])).toMatchObject({
      pr: 12,
      write: true,
      migration: 'adds-only',
    });
    expect(() => parseArgs(['x'])).toThrow('Usage');
    expect(() => parseArgs(['1', '--migration', 'maybe'])).toThrow('adds-only or moves-data');
  });
});

describe('AGENTS.md security section', () => {
  const md = '# A\n\n## Security invariants\n\n- rule\n\n## UI rules\n\n- ui\n';
  it('finds the section lines and the hunks inside it', () => {
    expect(sectionRange(md, 'Security invariants')).toEqual([3, 6]);
    expect(patchTouches('@@ -5,1 +5,2 @@\n-x\n+y', [3, 6], null)).toBe(true);
    expect(patchTouches('@@ -9,1 +9,1 @@\n-x\n+y', [3, 6], [3, 6])).toBe(false);
    expect(sectionRange(md, 'Missing')).toBeNull();
  });
});

describe('gatherFacts', () => {
  it('scores a docs-only PR with green checks and the CI coverage', () => {
    const gh = fakeGh({
      files: [{ filename: 'docs/x.md', status: 'modified', additions: 10, deletions: 2 }],
    });
    const facts = gatherFacts(5, { gh, map });
    expect(facts.input).toMatchObject({
      checks: 'green',
      coverage: 96,
      screenChanged: false,
      migrations: [],
    });
    expect(facts.input.files[0]).toMatchObject({ tier: 'docs' });
    expect(facts.logPath).toBe('docs/release-review/log.md');
  });

  it('reads workbook evidence for the head commit and a critical dependency bump', () => {
    const workbook =
      '| Stage | Status | Detail | Commit | Updated |\n| --- | --- | --- | --- | --- |\n| E2E | pass | e2e:electron-links ok | fffffff | d |\n';
    const gh = fakeGh({
      checks: [{ name: 'Test (ubuntu-latest)', id: 7, status: 'in_progress', conclusion: null }],
      files: [
        { filename: 'package.json', status: 'modified', additions: 1, deletions: 1 },
        {
          filename: 'packages/server/src/db/migrations/030_x.sql',
          status: 'added',
          additions: 5,
          deletions: 0,
        },
      ],
      contents: {
        'docs/workbooks/docs__x.md': workbook,
        'package.json': '{"dependencies":{"baileys":"7"}}',
        'docs/features': [{ type: 'dir', name: 'x' }],
      },
    });
    const facts = gatherFacts(5, { gh, map });
    expect(facts.input.evidence.e2e).toBe(true);
    expect(facts.input.evidence.linkCheck).toBe(true);
    expect(facts.input.checks).toBe('pending');
    expect(facts.input.coverage).toBeNull();
    expect(facts.input.migrations).toEqual(['packages/server/src/db/migrations/030_x.sql']);
    expect(facts.logPath).toBe('docs/features/x/review.md');
  });
});

describe('CI and review evidence', () => {
  const files = [
    { filename: 'apps/web/src/x.tsx', status: 'modified', additions: 3, deletions: 1 },
  ];
  const checks = [
    { name: 'Test (ubuntu-latest)', id: 7, status: 'completed', conclusion: 'success' },
    { name: 'Test (windows-latest)', id: 8, status: 'completed', conclusion: 'success' },
  ];
  const links = (conclusion) => ({
    8: { steps: [{ name: 'Run npm run e2e:electron-links', conclusion }] },
  });

  it('counts the Windows CI link check on the head without a workbook row', () => {
    const passed = gatherFacts(5, { gh: fakeGh({ files, checks, jobs: links('success') }), map });
    expect(passed.input.evidence.linkCheck).toBe(true);
    expect(passed.input.evidence.e2e).toBe(false);
    const skipped = gatherFacts(5, { gh: fakeGh({ files, checks, jobs: links('skipped') }), map });
    expect(skipped.input.evidence.linkCheck).toBe(false);
    const running = gatherFacts(5, {
      gh: fakeGh({
        files,
        checks: [{ ...checks[1], status: 'in_progress', conclusion: null }],
        jobs: links('success'),
      }),
      map,
    });
    expect(running.input.evidence.linkCheck).toBe(false);
  });

  it('reads review comments with their unresolved threads, or the count alone without GraphQL', () => {
    const comments = [{ id: 1 }, { id: 2 }];
    const withThreads = gatherFacts(5, {
      gh: fakeGh({
        files,
        reviewComments: comments,
        threads: [{ isResolved: true }, { isResolved: false }],
      }),
      map,
    });
    expect(withThreads.input.reviewComments).toEqual({ total: 2, open: 1 });
    const restOnly = gatherFacts(5, { gh: fakeGh({ files, reviewComments: comments }), map });
    expect(restOnly.input.reviewComments).toEqual({ total: 2, open: null });
    expect(gatherFacts(5, { gh: fakeGh({ files }), map }).input.reviewComments).toBeNull();
  });
});

describe('evidence after a branch update', () => {
  const workbook =
    '| Stage | Status | Detail | Commit | Updated |\n| --- | --- | --- | --- | --- |\n' +
    '| E2E | pass | e2e:electron-links | aaaaaaa | d |\n';
  const files = [
    { filename: 'apps/web/src/x.tsx', status: 'modified', additions: 3, deletions: 1 },
  ];
  const contents = { 'docs/workbooks/docs__x.md': workbook };
  const commits = [{ sha: 'a'.repeat(40) }];
  const e2e = (opts) => gatherFacts(5, { gh: fakeGh({ files, contents, commits, ...opts }), map });

  it('ignores files that came from main', () => {
    const since = {
      aaaaaaa: ['README.md', 'packages/server/src/app.ts', 'docs/workbooks/docs__x.md'],
    };
    expect(e2e({ since }).input.evidence.e2e).toBe(true);
  });
  it('still drops evidence when a PR file changed after it', () => {
    expect(
      e2e({ since: { aaaaaaa: ['README.md', 'apps/web/src/x.tsx'] } }).input.evidence.e2e,
    ).toBe(false);
  });
  it('drops evidence that names a commit outside this PR', () => {
    const since = { aaaaaaa: ['README.md'] };
    expect(e2e({ since, commits: [{ sha: 'c'.repeat(40) }] }).input.evidence.e2e).toBe(false);
  });
  it('treats a cut-off file list (300 files) as unknown', () => {
    const since = { aaaaaaa: Array.from({ length: 300 }, (_, i) => `docs/f${i}.md`) };
    expect(e2e({ since }).input.evidence.e2e).toBe(false);
  });
});

describe('main', () => {
  it('does not score a release PR', () => {
    const lines = [];
    expect(
      main(['9'], {
        gh: fakeGh({ title: 'chore(release): 0.1.52', files: [] }),
        log: (l) => lines.push(l),
      }),
    ).toBeNull();
    expect(lines[0]).toMatch(/release PR: not scored/);
  });
  it('prints the entry for a normal PR', () => {
    const lines = [];
    const gh = fakeGh({
      files: [{ filename: 'docs/x.md', status: 'modified', additions: 1, deletions: 0 }],
    });
    const result = main(['9'], { gh, log: (l) => lines.push(l), today: '2026-10-24' });
    expect(result).toMatchObject({ score: 100, decision: 'risk:auto' });
    expect(lines[0]).toContain('## 2026-10-24 · PR #9 · `fffffff` · risk:auto (100)');
  });
});
