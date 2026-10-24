#!/usr/bin/env node
// Release review: a safety score for one pull request (docs/superpowers/specs/2026-10-24-release-review-design.md).
//
//   node scripts/release-review.mjs <pr>                       print the score (Markdown, the PR comment)
//   node scripts/release-review.mjs <pr> --json                the full result as JSON
//   node scripts/release-review.mjs <pr> --migration adds-only|moves-data   after reading a new migration
//   node scripts/release-review.mjs <pr> --write               also append the review log entry + index row
//   node scripts/release-review.mjs <pr> --approve "<owner's words>"   record the owner's test approval
//
// Facts come from GitHub (gh api) at the PR head commit, so it works for any PR without a checkout.
// It never merges, tags or labels: the release-review skill posts the comment and sets the label.
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
  coverageFromLog,
  devBuildEvidence,
  devBuildRows,
  evidenceShaValid,
  workbookEvidence,
} from './review/evidence.mjs';
import { scoreChange } from './review/rubric.mjs';
import { applyCoreBump, coreBumpScore, corePin, prsFromCommits } from './review/core-bump.mjs';
import {
  INDEX,
  appendEntry,
  appendIndexRow,
  indexRow,
  logPathFor,
  renderApproval,
  renderEntry,
} from './review/log.mjs';

const MAP_PATH = 'docs/release-review/components.json';
const DEFAULT_COVERAGE_JOB = 'Test (ubuntu-latest)';
const GREEN = ['success', 'skipped', 'neutral'];

export const defaultGh = (args) =>
  execFileSync(resolveTool('gh'), args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

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
export function gatherFacts(pr, { gh = defaultGh, map, migrationConfirmed = null } = {}) {
  const json = (args) => JSON.parse(gh(args));
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim();
  const info = json([
    'pr',
    'view',
    String(pr),
    '--json',
    'title,headRefOid,baseRefOid,headRefName,state',
  ]);
  const head = info.headRefOid;
  const api = (path) => json(['api', `repos/${repo}/${path}`]);
  const file = (path, ref) => {
    try {
      return Buffer.from(api(`contents/${path}?ref=${ref}`).content, 'base64').toString('utf8');
    } catch {
      return null;
    }
  };
  const compare = api(`compare/${info.baseRefOid}...${head}`);
  const base = compare.merge_base_commit.sha;
  const sinceCache = new Map();
  // Only the PR's own files count: a branch update from main brings main's files in after the
  // evidence, and those were checked on main (CI still runs on the updated head).
  const prFiles = new Set(compare.files.map((f) => f.filename));
  // Evidence must name one of this PR's commits; GitHub lists at most 300 files per compare, so a
  // full list is unknown, never "nothing changed".
  const prCommits = (compare.commits ?? []).map((c) => c.sha);
  const ownCommit = (sha) => prCommits.some((c) => c.startsWith(sha));
  const changedFilesSince = (sha) => {
    if (!sinceCache.has(sha)) {
      try {
        const since = () => {
          if (sha === head.slice(0, sha.length)) return [];
          if (!ownCommit(sha)) return null;
          const files = api(`compare/${sha}...${head}`).files;
          if (files.length >= 300) return null;
          return files.map((f) => f.filename).filter((path) => prFiles.has(path));
        };
        sinceCache.set(sha, since());
      } catch {
        sinceCache.set(sha, null);
      }
    }
    return sinceCache.get(sha);
  };
  const isValid = (sha) => evidenceShaValid(sha, changedFilesSince, map);

  const files = compare.files.map((f) => ({
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

  const runs = api(`commits/${head}/check-runs?per_page=100`).check_runs;
  const checks = runs.some((r) => r.status !== 'completed')
    ? 'pending'
    : runs.every((r) => GREEN.includes(r.conclusion))
      ? 'green'
      : 'failed';
  const coverageRun = runs.find(
    (r) => r.name === (map.coverageJob ?? DEFAULT_COVERAGE_JOB) && r.status === 'completed',
  );
  let coverage = null;
  if (coverageRun)
    try {
      coverage = coverageFromLog(gh(['api', `repos/${repo}/actions/jobs/${coverageRun.id}/logs`]));
    } catch {
      coverage = null;
    }

  const workbookMarkdown = file(workbookPath(info.headRefName).replaceAll('\\', '/'), head);
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

  return {
    repo,
    coreBump,
    pr,
    title: info.title,
    head,
    branch: info.headRefName,
    logPath: logPathFor({ workbookMarkdown, branch: info.headRefName, featureFolders }),
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
      checks,
      coverage,
      evidence: {
        e2e: wb.e2e.ok,
        linkCheck: wb.linkCheck.ok,
        screenReview: wb.screenReview.ok,
        devBuild: db.devBuild,
        realTest: db.realTest,
      },
    },
  };
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
  { gh = defaultGh, log = console.log, today = new Date().toISOString().slice(0, 10) } = {},
) {
  const args = parseArgs(argv);
  const map = loadMap(MAP_PATH);
  const title = JSON.parse(gh(['pr', 'view', String(args.pr), '--json', 'title'])).title;
  if (/^chore\(release\)/.test(title)) {
    log('release PR: not scored (the release rule applies)');
    return null;
  }
  const facts = gatherFacts(args.pr, { gh, map, migrationConfirmed: args.migration });
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
  const entry = renderEntry({ date: today, pr: args.pr, sha, result, migrationNote });
  if (args.json)
    log(
      JSON.stringify(
        {
          ...facts,
          input: { ...facts.input, files: facts.input.files.map(({ patch: _patch, ...f }) => f) },
          result,
        },
        null,
        2,
      ),
    );
  else log(entry);
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
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
