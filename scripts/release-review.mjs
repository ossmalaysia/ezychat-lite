#!/usr/bin/env node
// Release review: the final merge check and safety score for one pull request
// (docs/superpowers/specs/2026-10-24-release-review-design.md). The first line is the verdict,
// `MERGE OK …` or `NOT READY: <reasons> …`; the exit code is 2 when it is not ready.
//
//   node scripts/release-review.mjs <pr>                       print the verdict and score (Markdown, the PR comment)
//   node scripts/release-review.mjs <pr> --json                the full result as JSON
//   node scripts/release-review.mjs <pr> --migration adds-only|moves-data   after reading a new migration
//   node scripts/release-review.mjs <pr> --write               also append the review log entry + index row
//   node scripts/release-review.mjs <pr> --approve "<owner's words>"   record the owner's test approval
//
// Facts come from the GitHub REST API (`gh api`, no GraphQL needed) at the PR head commit, so the same
// command works in a cloud session and on a PC, for any PR without a checkout. The repository is
// `GH_REPO` or the `origin` remote. It never merges, tags or labels: the release-review skill posts the
// comment and sets the label.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveTool, parseWorkbook, workbookPath } from './build-summary.mjs';
import {
  classifyFile,
  dependencyTier,
  isLockfile,
  isScreenFile,
  loadMap,
} from './review/components.mjs';
import {
  ciLinkCheck,
  coverageFromLog,
  devBuildEvidence,
  devBuildRows,
  ownDiffChanges,
  requiredChecks,
  reviewCommentCounts,
  workbookEvidence,
} from './review/evidence.mjs';
import { mergeVerdict, scoreChange } from './review/rubric.mjs';
import { applyCoreBump, coreBumpScore, corePin, prsFromCommits } from './review/core-bump.mjs';
import {
  INDEX,
  appendEntry,
  appendIndexRow,
  approvalsIn,
  indexRow,
  logPathFor,
  renderApproval,
  renderEntry,
} from './review/log.mjs';

const MAP_PATH = 'docs/release-review/components.json';
const DEFAULT_COVERAGE_JOB = 'Test (ubuntu-latest)';
/** The CI job that runs `npm run e2e:electron-links` (Windows runners have a desktop). */
const DEFAULT_LINK_CHECK_JOB = 'Test (windows-latest)';
/** Merge-blocking checks when the map names none (branch protection is not readable by every token). */
const DEFAULT_REQUIRED_CHECKS = [DEFAULT_COVERAGE_JOB, DEFAULT_LINK_CHECK_JOB];
/** How many older PR commits to search for the changed-lines coverage of the same PR diff. */
const COVERAGE_LOOKBACK = 10;

export const defaultGit = (args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });

export const defaultGh = (args) =>
  execFileSync(resolveTool('gh'), args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

/** `owner/name` from a git remote URL (https, ssh or a local proxy path). */
export function repoFromRemote(url) {
  const m = url.trim().match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The repository: `GH_REPO`, else the `origin` remote of the current checkout. */
export function currentRepo(
  env = process.env,
  remote = () => execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }),
) {
  const repo = env.GH_REPO || repoFromRemote(remote());
  if (!repo) throw new Error('Cannot tell the repository: set GH_REPO=owner/name');
  return repo;
}

/** The PR through REST (`gh pr view` needs GraphQL, which cloud sessions block). */
export const prInfo = (gh, repo, pr) => JSON.parse(gh(['api', `repos/${repo}/pulls/${pr}`]));

/** Line ranges `[start, end]` of a `## <title>` section (until the next `## `), 1-based. */
export function sectionRange(markdown, title) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (start < 0) return null;
  const next = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return [start + 1, next < 0 ? lines.length : next];
}

/** True when a unified-diff patch touches lines inside `range` of the new (or old) file. */
export function patchTouches(patch, newRange, oldRange) {
  for (const m of (patch ?? '').matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [oldStart, oldLen, newStart, newLen] = [m[1], m[2] ?? 1, m[3], m[4] ?? 1].map(Number);
    const hits = (range, start, len) =>
      range && start <= range[1] && start + Math.max(len, 1) - 1 >= range[0];
    if (hits(newRange, newStart, newLen) || hits(oldRange, oldStart, oldLen)) return true;
  }
  return false;
}

/** Everything the rubric needs, read from GitHub at the PR head. */
export function gatherFacts(
  pr,
  { gh = defaultGh, git = defaultGit, map, migrationConfirmed = null, repo = currentRepo() } = {},
) {
  const json = (args) => JSON.parse(gh(args));
  const info = prInfo(gh, repo, pr);
  const head = info.head.sha;
  const api = (path) => json(['api', `repos/${repo}/${path}`]);
  const file = (path, ref) => {
    try {
      return Buffer.from(api(`contents/${path}?ref=${ref}`).content, 'base64').toString('utf8');
    } catch {
      return null;
    }
  };
  // Three dots: from the merge base with main. Its file list stops at 300, so the PR's files come
  // from pulls/<n>/files (pages of 100, up to GitHub's 3,000) and its own diff from git.
  const compareOf = (sha) => api(`compare/${info.base.sha}...${sha}`);
  const compare = compareOf(head);
  const base = compare.merge_base_commit.sha;
  const prFiles = [];
  for (let page = 1; page <= 30; page++) {
    const batch = api(`pulls/${pr}/files?per_page=100&page=${page}`);
    prFiles.push(...batch);
    if (batch.length < 100) break;
  }
  // Evidence must name one of this PR's commits (a rebase gives new ids, so old evidence stops counting).
  const prCommits = (compare.commits ?? []).map((c) => c.sha);
  const fullSha = (sha) =>
    head.startsWith(sha) ? head : (prCommits.find((c) => c.startsWith(sha)) ?? null);
  /** `git diff -U0` of the PR's own change at a commit (fetched by id: works in a shallow clone). */
  const ownDiff = (sha, mergeBase) => {
    try {
      git(['cat-file', '-e', `${sha}^{commit}`]);
      git(['cat-file', '-e', `${mergeBase}^{commit}`]);
    } catch {
      git(['fetch', '--quiet', '--no-tags', 'origin', sha, mergeBase]);
    }
    return git(['diff', '-U0', '--no-color', '--no-renames', '--no-ext-diff', mergeBase, sha]);
  };
  let headDiff;
  // Evidence recorded at a commit still holds at the head when the PR's own change of every
  // non-neutral file is the same: merging main brings in main's files, which were checked on main.
  const validCache = new Map();
  const isValid = (sha) => {
    if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) return false;
    if (!validCache.has(sha)) {
      const full = fullSha(sha);
      let ok = false;
      if (full === head) ok = true;
      else if (full)
        try {
          headDiff ??= ownDiff(head, base);
          const before = ownDiff(full, compareOf(full).merge_base_commit.sha);
          ok = ownDiffChanges(before, headDiff, map)?.length === 0;
        } catch {
          ok = false;
        }
      validCache.set(sha, ok);
    }
    return validCache.get(sha);
  };

  const files = prFiles.map((f) => ({
    path: f.filename,
    status: f.status,
    added: f.additions,
    deleted: f.deletions,
    lockfile: isLockfile(f.filename),
    patch: f.patch,
    ...classifyFile(map, f.filename),
  }));

  let depTier = null;
  let coreBump = null;
  for (const f of files.filter((x) => x.path.endsWith('package.json'))) {
    const parse = (text) => (text ? JSON.parse(text) : {});
    const [before, after] = [parse(file(f.path, base)), parse(file(f.path, head))];
    const t = dependencyTier(map, before, after);
    if (t === 'critical' || (t && !depTier)) depTier = t;
    const prefix = map.coreBump?.packagePrefix;
    const [from, to] = prefix ? [corePin(before, prefix), corePin(after, prefix)] : [];
    if (!coreBump && from && to && from !== to) coreBump = { from, to };
  }
  if (coreBump) {
    const lite = map.coreBump.repo;
    const commits = json([
      'api',
      `repos/${lite}/compare/v${coreBump.from}...v${coreBump.to}`,
    ]).commits;
    // No Lite index yet means no reviewed Lite PR: every PR in the range is from before the review.
    const index = (() => {
      try {
        const path = `repos/${lite}/contents/docs/release-review/index.md`;
        return Buffer.from(json(['api', path]).content, 'base64').toString('utf8');
      } catch {
        return '';
      }
    })();
    coreBump = { ...coreBump, ...coreBumpScore(prsFromCommits(commits), index) };
  }

  const agents = files.find((f) => f.path === 'AGENTS.md');
  const agentsSecurityChanged = Boolean(
    agents &&
    patchTouches(
      agents.patch,
      sectionRange(
        file('AGENTS.md', head) ?? '',
        'Security invariants (do not break; each has tests)',
      ) ?? sectionRange(file('AGENTS.md', head) ?? '', 'Security invariants'),
      sectionRange(
        file('AGENTS.md', base) ?? '',
        'Security invariants (do not break; each has tests)',
      ) ?? sectionRange(file('AGENTS.md', base) ?? '', 'Security invariants'),
    ),
  );

  const runsAt = (sha) => api(`commits/${sha}/check-runs?per_page=100`).check_runs;
  const runs = runsAt(head);
  const required = requiredChecks(runs, map.requiredChecks ?? DEFAULT_REQUIRED_CHECKS);
  const coverageJob = map.coverageJob ?? DEFAULT_COVERAGE_JOB;
  const coverageAt = (jobs) => {
    const run = jobs.find((r) => r.name === coverageJob && r.status === 'completed');
    if (!run) return { done: false, value: null };
    try {
      return {
        done: true,
        value: coverageFromLog(gh(['api', `repos/${repo}/actions/jobs/${run.id}/logs`])),
      };
    } catch {
      return { done: true, value: null };
    }
  };
  // Coverage of the head; while its CI runs (or its log is gone), the newest PR commit with the same
  // PR diff that has a result. Neither: pending while CI runs, else unknown.
  const headCoverage = coverageAt(runs);
  let coverage = headCoverage.value;
  let coverageState = coverage === null ? (headCoverage.done ? 'unknown' : 'pending') : 'head';
  if (coverage === null)
    for (const sha of prCommits
      .filter((c) => c !== head)
      .reverse()
      .slice(0, COVERAGE_LOOKBACK)) {
      if (!isValid(sha)) continue;
      const older = coverageAt(runsAt(sha));
      if (older.value !== null) {
        [coverage, coverageState] = [older.value, sha.slice(0, 7)];
        break;
      }
    }

  // The desktop link check also counts when CI ran it on this head (Windows job, e2e:electron-links).
  const linkJob = runs.find(
    (r) => r.name === (map.linkCheckJob ?? DEFAULT_LINK_CHECK_JOB) && r.status === 'completed',
  );
  let ciLink = false;
  if (linkJob)
    try {
      ciLink = ciLinkCheck(api(`actions/jobs/${linkJob.id}`));
    } catch {
      ciLink = false;
    }
  const reviewComments = readReviewComments({ api, json, repo, pr });

  const workbookMarkdown = file(workbookPath(info.head.ref).replaceAll('\\', '/'), head);
  const workbook = workbookMarkdown ? parseWorkbook(workbookMarkdown) : null;
  const wb = workbookEvidence(workbook, isValid);
  const db = devBuildEvidence(devBuildRows(file('docs/dev-build-checks.md', head) ?? ''), isValid);
  const featureFolders = (() => {
    try {
      return api(`contents/docs/features?ref=${head}`)
        .filter((e) => e.type === 'dir')
        .map((e) => e.name);
    } catch {
      return [];
    }
  })();

  const logPath = logPathFor({ workbookMarkdown, branch: info.head.ref, featureFolders });
  // The newest owner approval in the log that still matches the PR's diff.
  const approved =
    approvalsIn(file(logPath, head), pr)
      .reverse()
      .find((sha) => isValid(sha)) ?? null;

  return {
    repo,
    coreBump,
    pr,
    title: info.title,
    head,
    branch: info.head.ref,
    logPath,
    merge: {
      state: info.merged_at ? 'merged' : info.state,
      draft: Boolean(info.draft),
      conflict: info.mergeable === false || info.mergeable_state === 'dirty',
      approved: approved?.slice(0, 7) ?? null,
    },
    unmapped: files.filter((f) => f.unmapped).map((f) => f.path),
    input: {
      files,
      dependencyTier: depTier,
      screenChanged: files.some((f) => isScreenFile(map, f.path)),
      migrations: files
        .filter((f) => f.status === 'added' && /(?:^|\/)migrations\//.test(f.path))
        .map((f) => f.path),
      migrationConfirmed,
      agentsSecurityChanged,
      checks: required.state,
      checkNames: { missing: required.missing, pending: required.pending, failed: required.failed },
      coverage,
      coverageState,
      reviewComments,
      evidence: {
        e2e: wb.e2e.ok,
        linkCheck: ciLink,
        screenReview: wb.screenReview.ok,
        devBuild: db.devBuild,
        realTest: db.realTest,
      },
    },
  };
}

/**
 * Review comments of the PR (REST) and how many threads are still unresolved: GraphQL
 * `reviewThreads`, else the cloud session's REST route `pulls/<n>/ccr/review_threads` (GraphQL is
 * blocked there); open is null when neither answers. Null when even the comments cannot be read.
 */
export function readReviewComments({ api, json, repo, pr }) {
  let comments;
  try {
    comments = api(`pulls/${pr}/comments?per_page=100`);
  } catch {
    return null;
  }
  let threads;
  try {
    const [owner, name] = repo.split('/');
    const query = `query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){reviewThreads(first:100){nodes{isResolved}}}}}`;
    threads = json([
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-F',
      `owner=${owner}`,
      '-F',
      `name=${name}`,
      '-F',
      `pr=${pr}`,
    ]).data.repository.pullRequest.reviewThreads.nodes;
  } catch {
    try {
      const ccr = api(`pulls/${pr}/ccr/review_threads`);
      threads = Array.isArray(ccr) ? ccr : (ccr?.threads ?? ccr?.review_threads ?? null);
    } catch {
      threads = null;
    }
  }
  return reviewCommentCounts(comments, threads);
}

export function parseArgs(argv) {
  const out = { pr: Number(argv[0]), write: false, json: false, migration: null, approve: null };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--write') out.write = true;
    else if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--migration') out.migration = argv[++i];
    else if (argv[i] === '--approve') out.approve = argv[++i];
  }
  if (!Number.isInteger(out.pr) || out.pr <= 0)
    throw new Error(
      'Usage: release-review.mjs <pr> [--write] [--json] [--migration adds-only|moves-data] [--approve "<text>"]',
    );
  if (out.migration && !['adds-only', 'moves-data'].includes(out.migration))
    throw new Error('--migration must be adds-only or moves-data');
  return out;
}

export function main(
  argv,
  {
    gh = defaultGh,
    git = defaultGit,
    log = console.log,
    today = new Date().toISOString().slice(0, 10),
    repo = currentRepo(),
  } = {},
) {
  const args = parseArgs(argv);
  const map = loadMap(MAP_PATH);
  if (/^chore\(release\)/.test(prInfo(gh, repo, args.pr).title)) {
    log('release PR: not scored (the release rule applies)');
    return null;
  }
  const facts = gatherFacts(args.pr, { gh, git, map, migrationConfirmed: args.migration, repo });
  const sha = facts.head.slice(0, 7);
  if (args.approve) {
    appendEntry(
      facts.logPath,
      renderApproval({ date: today, pr: args.pr, sha, quote: args.approve }),
    );
    appendIndexRow(
      INDEX,
      indexRow({
        date: today,
        pr: args.pr,
        sha,
        tier: '—',
        score: '—',
        decision: 'human-approved',
        logPath: facts.logPath,
      }),
    );
    log(`Recorded the owner's approval in ${facts.logPath} and ${INDEX}.`);
    return null;
  }
  const result = applyCoreBump(scoreChange(facts.input), facts.coreBump);
  const migrationNote = facts.input.migrations.length
    ? `${facts.input.migrations.join(', ')} — ${args.migration ?? 'not confirmed yet'}`
    : '';
  const verdict = mergeVerdict(result, facts.merge);
  const entry = renderEntry({
    date: today,
    pr: args.pr,
    sha,
    result,
    migrationNote,
    verdict: verdict.line,
  });
  if (args.json)
    log(
      JSON.stringify(
        {
          ...facts,
          input: { ...facts.input, files: facts.input.files.map(({ patch: _patch, ...f }) => f) },
          result,
          verdict,
        },
        null,
        2,
      ),
    );
  else log(`${verdict.line}\n\n${entry}`);
  if (facts.unmapped.length)
    log(
      `Unmapped code files (counted as core; add them to ${MAP_PATH}): ${facts.unmapped.join(', ')}`,
    );
  if (args.write) {
    appendEntry(facts.logPath, entry);
    appendIndexRow(
      INDEX,
      indexRow({
        date: today,
        pr: args.pr,
        sha,
        tier: result.tier,
        score: result.score,
        decision: result.decision,
        logPath: facts.logPath,
      }),
    );
    log(`Wrote ${facts.logPath} and ${INDEX}. Commit only these files.`);
  }
  return { ...result, verdict };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (main(process.argv.slice(2))?.verdict.ok === false) process.exitCode = 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
