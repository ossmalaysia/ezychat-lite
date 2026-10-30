import { describe, expect, it } from 'vitest';
import { loadMap } from './review/components.mjs';
import {
  currentRepo,
  gatherFacts,
  main,
  parseArgs,
  patchTouches,
  repoFromRemote,
  sectionRange,
} from './release-review.mjs';

const map = loadMap('docs/release-review/components.json');
const HEAD = 'f'.repeat(40);
const b64 = (text) => Buffer.from(text).toString('base64');

const BASE = 'b'.repeat(40);
const COVERAGE_LOG = 'changed-lines coverage: 96.0 % (24/25 lines, minimum 90 %)';
const green = (name, id) => ({ name, id, status: 'completed', conclusion: 'success' });
const REQUIRED = (map.requiredChecks ?? []).map((name, i) => green(name, 100 + i));

/**
 * A fake `gh` for one PR, REST only (like a cloud session): answers by the API path.
 * `diffs` = the PR's own `git diff -U0` per commit (full sha), `checksAt` / `logs` = CI of older commits.
 */
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
  checksAt = {},
  logs = {},
  contents = {},
  commits = [],
  jobs = {},
  reviewComments = null,
  threads = null,
  ccrThreads = null,
  pull = {},
}) {
  return (args) => {
    const key = args.join(' ');
    if (args[0] !== 'api') throw new Error(`GraphQL-only gh call: ${key}`);
    if (args[1] === 'graphql') {
      if (!threads) throw new Error('HTTP 403: GraphQL is not available');
      return JSON.stringify({
        data: { repository: { pullRequest: { reviewThreads: { nodes: threads } } } },
      });
    }
    const path = args[1].replace('repos/o/r/', '');
    if (/^pulls\/\d+$/.test(path))
      return JSON.stringify({
        title,
        head: { sha: HEAD, ref: 'docs/x' },
        base: { sha: BASE },
        state: 'open',
        draft: false,
        mergeable: true,
        ...pull,
      });
    const page = path.match(/^pulls\/\d+\/files\?per_page=100&page=(\d+)$/)?.[1];
    if (page) return JSON.stringify(files.slice((page - 1) * 100, page * 100));
    if (path === 'pulls/5/ccr/review_threads') {
      if (!ccrThreads) throw new Error('404');
      return JSON.stringify(ccrThreads);
    }
    if (path.startsWith('pulls/5/comments')) {
      if (!reviewComments) throw new Error('404');
      return JSON.stringify(reviewComments);
    }
    const log = path.match(/^actions\/jobs\/(\d+)\/logs$/)?.[1];
    if (log) {
      if (logs[log] === null) throw new Error('410 gone');
      return logs[log] ?? COVERAGE_LOG;
    }
    const job = path.match(/^actions\/jobs\/(\d+)$/)?.[1];
    if (job) return JSON.stringify(jobs[job] ?? { steps: [] });
    const to = path.match(/^compare\/b+\.\.\.([0-9a-f]+)$/)?.[1];
    if (to)
      return JSON.stringify({
        merge_base_commit: { sha: to === HEAD ? 'm'.repeat(40) : 'n'.repeat(40) },
        files: files.slice(0, 300),
        commits,
      });
    const runsOf = path.match(/^commits\/([0-9a-f]+)\/check-runs/)?.[1];
    if (runsOf)
      return JSON.stringify({ check_runs: runsOf === HEAD ? checks : (checksAt[runsOf] ?? []) });
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

/** A fake `git`: the own diff of each commit (`diffs`, default empty), fetches are recorded. */
function fakeGit(diffs = {}, fetched = []) {
  return (args) => {
    if (args[0] === 'cat-file') {
      if (args[2].startsWith('m')) throw new Error('missing');
      return '';
    }
    if (args[0] === 'fetch') {
      fetched.push(args.slice(4));
      return '';
    }
    if (args[0] === 'diff') {
      const sha = args.at(-1);
      if (!(sha in diffs)) throw new Error(`bad object ${sha}`);
      return diffs[sha];
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

const facts = ({ diffs, fetched, ...opts }) =>
  gatherFacts(5, { gh: fakeGh(opts), git: fakeGit(diffs, fetched), map, repo: 'o/r' });

describe('repository', () => {
  it('reads owner/name from GH_REPO or the origin remote, also a cloud proxy URL', () => {
    expect(repoFromRemote('https://github.com/ossmalaysia/ezychat-lite.git')).toBe(
      'ossmalaysia/ezychat-lite',
    );
    expect(repoFromRemote('git@github.com:o/r.git\n')).toBe('o/r');
    expect(repoFromRemote('http://local_proxy@127.0.0.1:41753/git/o/r')).toBe('o/r');
    expect(repoFromRemote('nonsense')).toBeNull();
    expect(currentRepo({ GH_REPO: 'a/b' }, () => '')).toBe('a/b');
    expect(currentRepo({}, () => 'https://github.com/c/d')).toBe('c/d');
    expect(() => currentRepo({}, () => 'nonsense')).toThrow('GH_REPO');
  });
});

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
    const f = facts({
      checks: REQUIRED,
      files: [{ filename: 'docs/x.md', status: 'modified', additions: 10, deletions: 2 }],
    });
    expect(f.input).toMatchObject({
      checks: 'green',
      coverage: 96,
      coverageState: 'head',
      screenChanged: false,
      migrations: [],
    });
    expect(f.input.files[0]).toMatchObject({ tier: 'docs' });
    expect(f.logPath).toBe('docs/release-review/log.md');
    expect(f.merge).toEqual({ state: 'open', draft: false, conflict: false, approved: null });
  });

  it('reads workbook evidence for the head commit and a critical dependency bump', () => {
    const workbook =
      '| Stage | Status | Detail | Commit | Updated |\n| --- | --- | --- | --- | --- |\n| E2E | pass | e2e:electron-links ok | fffffff | d |\n';
    const f = facts({
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
    expect(f.input.evidence.e2e).toBe(true);
    // The link check is CI's fact: a workbook line naming it no longer counts.
    expect(f.input.evidence.linkCheck).toBe(false);
    expect(f.input.checks).toBe('pending');
    expect(f.input.coverage).toBeNull();
    expect(f.input.coverageState).toBe('pending');
    expect(f.input.migrations).toEqual(['packages/server/src/db/migrations/030_x.sql']);
    expect(f.logPath).toBe('docs/features/x/review.md');
  });
});

describe('required checks', () => {
  const files = [{ filename: 'docs/x.md', status: 'modified', additions: 1, deletions: 0 }];
  it('names the required checks that are missing, running or failed and ignores the others', () => {
    const [sonar, ubuntu, windows] = REQUIRED;
    const f = facts({
      files,
      checks: [
        sonar,
        { ...ubuntu, status: 'in_progress', conclusion: null },
        { ...windows, conclusion: 'failure' },
        { name: 'Some optional bot', id: 1, status: 'completed', conclusion: 'failure' },
      ],
    });
    expect(f.input.checks).toBe('failed');
    expect(f.input.checkNames).toEqual({
      missing: ['Test (macos-latest)'],
      pending: ['Test (ubuntu-latest)'],
      failed: ['Test (windows-latest)'],
    });
    const optionalRed = facts({
      files,
      checks: [...REQUIRED, { name: 'Bot', id: 2, status: 'completed', conclusion: 'failure' }],
    });
    expect(optionalRed.input.checks).toBe('green');
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
    const passed = facts({ files, checks, jobs: links('success') });
    expect(passed.input.evidence.linkCheck).toBe(true);
    expect(passed.input.evidence.e2e).toBe(false);
    expect(facts({ files, checks, jobs: links('skipped') }).input.evidence.linkCheck).toBe(false);
    const running = facts({
      files,
      checks: [{ ...checks[1], status: 'in_progress', conclusion: null }],
      jobs: links('success'),
    });
    expect(running.input.evidence.linkCheck).toBe(false);
  });

  it('reads unresolved threads from GraphQL, else the CCR REST route, else the count alone', () => {
    const comments = [{ id: 1 }, { id: 2 }];
    const graphql = facts({
      files,
      reviewComments: comments,
      threads: [{ isResolved: true }, { isResolved: false }],
    });
    expect(graphql.input.reviewComments).toEqual({ total: 2, open: 1 });
    const ccr = facts({
      files,
      reviewComments: comments,
      ccrThreads: [{ is_resolved: false }, { is_resolved: false }],
    });
    expect(ccr.input.reviewComments).toEqual({ total: 2, open: 2 });
    const wrapped = facts({ files, reviewComments: comments, ccrThreads: { threads: [] } });
    expect(wrapped.input.reviewComments).toEqual({ total: 2, open: 0 });
    expect(facts({ files, reviewComments: comments }).input.reviewComments).toEqual({
      total: 2,
      open: null,
    });
    expect(facts({ files }).input.reviewComments).toBeNull();
  });
});

/** A `git diff -U0` section for one file. */
const gitDiff = (path, body) =>
  `diff --git a/${path} b/${path}\nindex 1..2 100644\n--- a/${path}\n+++ b/${path}\n${body}\n`;

describe('evidence after a branch update (the PR diff decides)', () => {
  const A = 'a'.repeat(40);
  const workbook =
    '| Stage | Status | Detail | Commit | Updated |\n| --- | --- | --- | --- | --- |\n' +
    '| E2E | pass | npm run e2e | aaaaaaa | d |\n';
  const files = [
    { filename: 'apps/web/src/x.tsx', status: 'modified', additions: 3, deletions: 1 },
  ];
  const contents = { 'docs/workbooks/docs__x.md': workbook };
  const commits = [{ sha: A }, { sha: HEAD }];
  const x = (body) => gitDiff('apps/web/src/x.tsx', body);
  const e2e = (atA, atHead, opts = {}) =>
    facts({ files, contents, commits, diffs: { [A]: atA, [HEAD]: atHead }, ...opts }).input.evidence
      .e2e;

  it('keeps evidence when main moved under the PR: same own change at other line numbers', () => {
    const fetched = [];
    expect(
      e2e(
        x('@@ -10 +10,2 @@\n+b'),
        x('@@ -14 +14,2 @@\n+b') + gitDiff('docs/workbooks/docs__x.md', '+row'),
        {
          fetched,
        },
      ),
    ).toBe(true);
    // The head's merge base was not local (shallow clone): fetched by id.
    expect(fetched).toContainEqual([HEAD, 'm'.repeat(40)]);
  });
  it('drops evidence when the PR changed one of its own files after it', () => {
    expect(e2e(x('@@ -10 +10,2 @@\n+b'), x('@@ -10 +10,2 @@\n+B'))).toBe(false);
  });
  it('drops evidence when the PR added a code file after it', () => {
    expect(e2e(x('+b'), x('+b') + gitDiff('packages/server/src/y.ts', '+y'))).toBe(false);
  });
  it('drops evidence that names a commit outside this PR, or whose diff cannot be read', () => {
    expect(e2e(x('+b'), x('+b'), { commits: [{ sha: 'c'.repeat(40) }] })).toBe(false);
    expect(facts({ files, contents, commits, diffs: { [HEAD]: x('+b') } }).input.evidence.e2e).toBe(
      false,
    );
  });
  it('reads every page of a PR with more than 300 files', () => {
    const many = Array.from({ length: 456 }, (_, i) => ({
      filename: `packages/server/src/f${i}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 0,
    }));
    expect(facts({ files: many }).input.files).toHaveLength(456);
  });
});

describe('changed-lines coverage while CI runs', () => {
  const [A, C] = ['a'.repeat(40), 'c'.repeat(40)];
  const code = {
    filename: 'packages/server/src/x.ts',
    status: 'modified',
    additions: 1,
    deletions: 0,
  };
  const same = gitDiff('packages/server/src/x.ts', '+x');
  const running = [
    { name: 'Test (ubuntu-latest)', id: 7, status: 'in_progress', conclusion: null },
  ];
  const done = (id) => [
    { name: 'Test (ubuntu-latest)', id, status: 'completed', conclusion: 'success' },
  ];
  const base = {
    files: [code],
    checks: running,
    commits: [{ sha: A }, { sha: C }, { sha: HEAD }],
  };

  it('takes the newest older commit with the same PR diff and a result', () => {
    const f = facts({
      ...base,
      diffs: { [A]: same, [C]: same, [HEAD]: same },
      checksAt: { [A]: done(11), [C]: done(12) },
      logs: { 11: 'changed-lines coverage: 91.0 %', 12: 'changed-lines coverage: 93.0 %' },
    });
    expect(f.input).toMatchObject({ coverage: 93, coverageState: 'ccccccc' });
  });
  it('skips an older commit whose PR diff differs, and is pending when none is left', () => {
    const f = facts({
      ...base,
      diffs: { [A]: gitDiff('packages/server/src/x.ts', '+old'), [C]: same, [HEAD]: same },
      checksAt: { [A]: done(11), [C]: running },
    });
    expect(f.input).toMatchObject({ coverage: null, coverageState: 'pending' });
  });
  it('is unknown when the head job finished without a readable result', () => {
    const f = facts({ ...base, checks: done(7), logs: { 7: null } });
    expect(f.input).toMatchObject({ coverage: null, coverageState: 'unknown' });
  });
});

describe('merge facts', () => {
  const files = [{ filename: 'docs/x.md', status: 'modified', additions: 1, deletions: 0 }];
  const A = 'a'.repeat(40);
  const approval = (sha) =>
    `# Review log\n\n## 2026-10-30 · PR #5 · \`${sha}\` · approved by the owner\n\n> ok\n`;
  const log = { 'docs/release-review/log.md': approval('aaaaaaa') };
  it('reads draft, conflict and an owner approval of the current PR diff', () => {
    const same = gitDiff('packages/server/src/x.ts', '+x');
    const f = facts({
      files,
      pull: { draft: true, mergeable: false },
      commits: [{ sha: A }],
      diffs: { [A]: same, [HEAD]: same },
      contents: log,
    });
    expect(f.merge).toEqual({ state: 'open', draft: true, conflict: true, approved: 'aaaaaaa' });
  });
  it('reports a merged PR', () => {
    expect(facts({ files, pull: { state: 'closed', merged_at: '2026-10-30' } }).merge.state).toBe(
      'merged',
    );
  });
  it('ignores an approval of an older PR diff', () => {
    const f = facts({
      files,
      commits: [{ sha: A }],
      diffs: {
        [A]: gitDiff('packages/server/src/x.ts', '+old'),
        [HEAD]: gitDiff('packages/server/src/x.ts', '+new'),
      },
      contents: log,
    });
    expect(f.merge.approved).toBeNull();
  });
});

describe('main', () => {
  const opts = (gh, lines) => ({
    gh,
    git: fakeGit(),
    log: (l) => lines.push(l),
    today: '2026-10-24',
    repo: 'o/r',
  });
  it('does not score a release PR', () => {
    const lines = [];
    expect(
      main(['9'], opts(fakeGh({ title: 'chore(release): 0.1.52', files: [] }), lines)),
    ).toBeNull();
    expect(lines[0]).toMatch(/release PR: not scored/);
  });
  it('prints the verdict line first, then the entry', () => {
    const lines = [];
    const gh = fakeGh({
      checks: REQUIRED,
      files: [{ filename: 'docs/x.md', status: 'modified', additions: 1, deletions: 0 }],
    });
    const result = main(['9'], opts(gh, lines));
    expect(result).toMatchObject({ score: 100, decision: 'risk:auto', verdict: { ok: true } });
    expect(lines[0].split('\n')[0]).toBe('MERGE OK · risk:auto (100)');
    expect(lines[0]).toContain('## 2026-10-24 · PR #9 · `fffffff` · risk:auto (100)');
  });
  it('says NOT READY with the missing required check by name', () => {
    const lines = [];
    const gh = fakeGh({
      checks: REQUIRED.slice(1),
      files: [{ filename: 'docs/x.md', status: 'modified', additions: 1, deletions: 0 }],
    });
    expect(main(['9'], opts(gh, lines)).verdict.ok).toBe(false);
    expect(lines[0].split('\n')[0]).toBe(
      'NOT READY: checks pending (missing: SonarCloud Code Analysis) · risk:human (100)',
    );
  });
});
