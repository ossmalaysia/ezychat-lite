#!/usr/bin/env node
// Build summary: one console view per feature PR, from the feature's workbook
// (docs/workbooks/<branch>.md, committed on the feature branch and updated by every agent) plus the
// live PR state on GitHub: CI unit tests per OS, SonarCloud, review comments and whether it can merge.
//
//   node scripts/build-summary.mjs                    open PRs + the 3 most recently merged
//   node scripts/build-summary.mjs 47                 one PR
//   node scripts/build-summary.mjs record <stage> <status> "<detail>" [--title "Feature name"]
//       update the current branch's workbook (then commit it with the work)
//       stages:   design | dev | unit | e2e | devbuild | screen
//       statuses: todo | doing | done | pass | fail | skip
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STAGES = ['Design', 'Dev', 'Unit tests', 'E2E', 'Dev Build', 'Screen review'];
const STAGE_ALIASES = {
  design: 'Design',
  dev: 'Dev',
  unit: 'Unit tests',
  e2e: 'E2E',
  devbuild: 'Dev Build',
  screen: 'Screen review',
};
const STATUSES = ['todo', 'doing', 'done', 'pass', 'fail', 'skip'];
const OS = ['ubuntu', 'windows', 'macos'];

export const workbookPath = (branch) =>
  join('docs', 'workbooks', `${branch.replace(/[^\w.-]+/g, '__')}.md`);

/* ------------------------------------------------------------------------------- workbook */

const cellsOf = (line) =>
  line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());

/** The stage table of a workbook: { stages: { Design: { status, detail, updated }, … } }. */
export function parseWorkbook(markdown) {
  const stages = {};
  for (const line of markdown.split('\n')) {
    const [stage, status, detail, updated] = cellsOf(line);
    if (STAGES.includes(stage) && STATUSES.includes(status))
      stages[stage] = { status, detail: detail ?? '', updated: updated ?? '' };
  }
  return { stages };
}

const tableRow = (stage, { status, detail, updated }) =>
  `| ${stage} | ${status} | ${detail.replace(/\|/g, '/')} | ${updated} |`;

/** A workbook with `stage` set (a new one when `markdown` is null) and one log line appended. */
export function setStage(markdown, { title, branch }, stage, status, detail, date) {
  if (!STAGES.includes(stage)) throw new Error(`Unknown stage "${stage}": ${STAGES.join(', ')}`);
  if (!STATUSES.includes(status))
    throw new Error(`Unknown status "${status}": ${STATUSES.join(', ')}`);
  const stages = markdown ? parseWorkbook(markdown).stages : {};
  stages[stage] = { status, detail, updated: date };
  const head = markdown
    ? markdown.slice(0, markdown.indexOf('| Stage |'))
    : `# Workbook: ${title}\n\nBranch: \`${branch}\` · Every agent updates its stage with\n\`node scripts/build-summary.mjs record <stage> <status> "<detail>"\` and commits it with the work.\n\n`;
  const log =
    markdown && markdown.includes('## Log')
      ? markdown.slice(markdown.indexOf('## Log'))
      : '## Log\n';
  const table = [
    '| Stage | Status | Detail | Updated |',
    '| --- | --- | --- | --- |',
    ...STAGES.map((name) =>
      tableRow(name, stages[name] ?? { status: 'todo', detail: '', updated: '' }),
    ),
  ].join('\n');
  return `${head}${table}\n\n${log.trimEnd()}\n${log.trimEnd() === '## Log' ? '\n' : ''}- ${date} ${stage}: ${status} — ${detail}\n`;
}

/* ------------------------------------------------------------------------- other sources */

/** Pass/fail counts of a feature's rows in the Dev Build check log ("same" rows inherit). */
export function devBuildSummary(markdown, { number, branch }) {
  const counts = { pass: 0, fail: 0 };
  const ours = new RegExp(`#${number}(?!\\d)|${branch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`);
  let current = false;
  for (const line of markdown.split('\n')) {
    const cells = cellsOf(line);
    if (cells.length < 6 || !/^\d{4}-\d{2}-\d{2}$/.test(cells[0] ?? '')) continue;
    current = /^same\b/i.test(cells[1]) ? current : ours.test(cells[1]);
    if (!current) continue;
    if (/\*\*Fail\*\*|^Fail/i.test(cells[4])) counts.fail++;
    else if (/^Pass/i.test(cells[4])) counts.pass++;
  }
  return counts;
}

const outcome = (check) =>
  check.status && check.status !== 'COMPLETED'
    ? 'running'
    : check.conclusion === 'SUCCESS'
      ? 'pass'
      : check.conclusion === 'SKIPPED' || check.conclusion === 'NEUTRAL'
        ? 'skip'
        : 'fail';

/** CI checks of the PR's head: the unit-test job per OS and SonarCloud. */
export function ciSummary(checks) {
  const unit = {};
  let quality = null;
  for (const check of checks) {
    const os = OS.find((name) => check.name?.startsWith(`Test (${name}`));
    if (os) unit[os] = outcome(check);
    else if (/sonar/i.test(check.name ?? '')) quality = outcome(check);
  }
  return { unit, quality };
}

/* --------------------------------------------------------------------------------- render */

const MARK = { done: '✓', pass: '✓', fail: '✗', doing: '…', running: '…', todo: '·', skip: '–' };
const row = (label, text) => `  ${label.padEnd(14)} ${text}`;
const stageText = (entry, empty) =>
  entry && entry.status !== 'todo'
    ? `${MARK[entry.status]} ${entry.detail || entry.status}${entry.updated ? `  (${entry.updated})` : ''}`
    : `· ${empty}`;

/** One feature as a short block of aligned lines. */
export function renderFeature(f) {
  const lines = [`#${f.number}  ${f.title}  (${f.branch})`];
  if (f.state === 'MERGED') {
    lines.push(row('Dev', `✓ merged${f.mergedAt ? ` ${f.mergedAt.slice(0, 10)}` : ''}`));
    return lines.join('\n');
  }
  const stages = f.workbook?.stages ?? {};
  lines.push(
    row(
      'Dev',
      `${f.isDraft ? '◐ draft PR' : '● PR open, ready for review'}, ${f.commits} commit${f.commits === 1 ? '' : 's'}`,
    ),
  );
  if (!f.workbook)
    lines.push(row('Workbook', `✗ missing: ${workbookPath(f.branch).replace(/\\/g, '/')}`));
  lines.push(row('Design', stageText(stages.Design, 'not recorded')));
  const unit = OS.filter((os) => f.ci.unit[os]);
  lines.push(
    row(
      'Unit tests',
      unit.length
        ? `${unit.every((os) => f.ci.unit[os] === 'pass') ? '✓' : unit.some((os) => f.ci.unit[os] === 'fail') ? '✗' : '…'} CI ${unit.map((os) => `${os} ${MARK[f.ci.unit[os]]}`).join(' ')}`
        : stageText(stages['Unit tests'], 'CI not run yet'),
    ),
  );
  lines.push(
    row('Quality', f.ci.quality ? `${MARK[f.ci.quality]} SonarCloud` : '· SonarCloud not run yet'),
  );
  lines.push(row('E2E', stageText(stages.E2E, 'not recorded')));
  const { pass, fail } = f.devBuild;
  lines.push(
    row(
      'Dev Build',
      stages['Dev Build'] && stages['Dev Build'].status !== 'todo'
        ? stageText(stages['Dev Build'], '')
        : pass + fail === 0
          ? '· no checks logged'
          : fail === 0
            ? `✓ ${pass} checks passed`
            : `✗ ${fail} failed, ${pass} passed (see docs/dev-build-checks.md)`,
    ),
  );
  lines.push(row('Screen review', stageText(stages['Screen review'], 'not recorded')));
  lines.push(
    row(
      'Review',
      f.openComments
        ? `✗ ${f.openComments} open comment${f.openComments === 1 ? '' : 's'}`
        : '✓ no open comments',
    ),
  );
  const merge = {
    CLEAN: '✓ ready to merge',
    UNKNOWN: '· GitHub is still checking (run again in a minute)',
    UNSTABLE: '◐ mergeable, some checks not green',
    BEHIND: '◐ behind main: update the branch',
    BLOCKED: '✗ blocked (checks or comments)',
    DIRTY: '✗ merge conflicts',
    DRAFT: '◐ draft',
  };
  lines.push(row('Mergeable', merge[f.mergeState] ?? `· ${String(f.mergeState).toLowerCase()}`));
  return lines.join('\n');
}

/* ----------------------------------------------------------------- live data (gh, git) */

const gh = (args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    open: pullRequests(states: OPEN, first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ...pr } }
    merged: pullRequests(states: MERGED, first: 3, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ...pr } }
  }
}
fragment pr on PullRequest {
  number title headRefName headRefOid isDraft state mergeStateStatus mergedAt
  commits(last: 1) { totalCount nodes { commit { statusCheckRollup { contexts(first: 30) { nodes {
    ... on CheckRun { name status conclusion }
  } } } } } }
  reviewThreads(first: 100) { nodes { isResolved } }
}`;

function fileAt(nameWithOwner, path, ref) {
  try {
    return gh([
      'api',
      `repos/${nameWithOwner}/contents/${path}?ref=${ref}`,
      '-H',
      'Accept: application/vnd.github.raw',
    ]);
  } catch {
    return null;
  }
}

function features(only) {
  const nameWithOwner = gh([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner',
  ]).trim();
  const [owner, name] = nameWithOwner.split('/');
  const data = JSON.parse(
    gh(['api', 'graphql', '-f', `query=${QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`]),
  ).data.repository;
  const prs = [...data.open.nodes, ...data.merged.nodes].filter(
    (pr) => !only || pr.number === only,
  );
  return prs.map((pr) => {
    const checks = pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
    const open = pr.state !== 'MERGED';
    const workbook = open
      ? fileAt(nameWithOwner, workbookPath(pr.headRefName).replace(/\\/g, '/'), pr.headRefOid)
      : null;
    const log = open ? fileAt(nameWithOwner, 'docs/dev-build-checks.md', pr.headRefOid) : null;
    return {
      number: pr.number,
      title: pr.title,
      branch: pr.headRefName,
      state: pr.state,
      isDraft: pr.isDraft,
      mergedAt: pr.mergedAt,
      commits: pr.commits.totalCount,
      ci: ciSummary(checks.filter((check) => check.name)),
      workbook: workbook ? parseWorkbook(workbook) : null,
      devBuild: log
        ? devBuildSummary(log, { number: pr.number, branch: pr.headRefName })
        : { pass: 0, fail: 0 },
      openComments: pr.reviewThreads.nodes.filter((thread) => !thread.isResolved).length,
      mergeState: pr.mergeStateStatus,
    };
  });
}

function record(args) {
  const titleAt = args.indexOf('--title');
  const title = titleAt >= 0 ? args[titleAt + 1] : null;
  const [alias, status, detail] = titleAt >= 0 ? args.slice(0, titleAt) : args;
  const stage = STAGE_ALIASES[String(alias).toLowerCase()];
  if (!stage || !detail)
    throw new Error(
      'Usage: build-summary.mjs record design|dev|unit|e2e|devbuild|screen todo|doing|done|pass|fail|skip "detail" [--title "Feature"]',
    );
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  const path = workbookPath(branch);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const date = new Date().toISOString().slice(0, 10);
  const next = setStage(current, { title: title ?? branch, branch }, stage, status, detail, date);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
  console.log(`${path}: ${stage} → ${status} (${detail}). Commit it with the work.`);
}

function main(args) {
  if (args[0] === 'record') return record(args.slice(1));
  const only = args[0] ? Number(args[0]) : null;
  const list = features(only);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  console.log(`Build summary — ${stamp}\n`);
  if (!list.length) console.log('No pull requests found.');
  for (const feature of list) console.log(`${renderFeature(feature)}\n`);
  console.log('✓ done  ✗ problem  … in progress  ◐ partly  · not yet  – not needed');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main(process.argv.slice(2));
