#!/usr/bin/env node
// Build summary: one console view per feature PR, from the feature's workbook
// (docs/workbooks/<branch>.md, committed on the feature branch and updated by every agent) plus the
// live PR state on GitHub: CI unit tests per OS, SonarCloud, review comments and whether it can merge.
//
//   node scripts/build-summary.mjs                    open PRs + the 3 most recently merged
//   node scripts/build-summary.mjs 47                 one PR (any age)
//   node scripts/build-summary.mjs record <stage> <status> "<detail>" [--title "Feature name"]
//       update the current branch's workbook (then commit it with the work)
//       stages:   design | dev | unit | e2e | devbuild | screen
//       statuses: todo | doing | done | pass | fail | skip
// gh and git run from their usual install paths (or GH_PATH / GIT_PATH), never a PATH lookup.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
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
const TODO = { status: 'todo', detail: '', updated: '' };

export const workbookPath = (branch) =>
  join('docs', 'workbooks', `${branch.replaceAll(/[^\w.-]+/g, '__')}.md`);

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
  `| ${stage} | ${status} | ${detail.replaceAll('|', '/')} | ${updated} |`;

const workbookHead = (title, branch) =>
  [
    `# Workbook: ${title}`,
    '',
    `Branch: \`${branch}\` · Every agent updates its stage with`,
    '`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.',
    '',
    '',
  ].join('\n');

/** A workbook with `stage` set (a new one when `markdown` is null) and one log line appended. */
export function setStage(markdown, { title, branch }, stage, status, detail, date) {
  if (!STAGES.includes(stage)) throw new Error(`Unknown stage "${stage}": ${STAGES.join(', ')}`);
  if (!STATUSES.includes(status))
    throw new Error(`Unknown status "${status}": ${STATUSES.join(', ')}`);
  const stages = markdown ? parseWorkbook(markdown).stages : {};
  stages[stage] = { status, detail, updated: date };
  const head = markdown
    ? markdown.slice(0, markdown.indexOf('| Stage |'))
    : workbookHead(title, branch);
  const log = markdown?.includes('## Log')
    ? markdown.slice(markdown.indexOf('## Log')).trimEnd()
    : '## Log';
  const table = [
    '| Stage | Status | Detail | Updated |',
    '| --- | --- | --- | --- |',
    ...STAGES.map((name) => tableRow(name, stages[name] ?? TODO)),
  ].join('\n');
  const gap = log === '## Log' ? '\n\n' : '\n';
  return `${head}${table}\n\n${log}${gap}- ${date} ${stage}: ${status} — ${detail}\n`;
}

/* ------------------------------------------------------------------------- other sources */

const escapeRegExp = (text) => text.replaceAll(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`);

/** Pass/fail counts of a feature's rows in the Dev Build check log ("same" rows inherit). */
export function devBuildSummary(markdown, { number, branch }) {
  const counts = { pass: 0, fail: 0 };
  const ours = new RegExp(String.raw`#${number}(?!\d)|${escapeRegExp(branch)}`);
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

const CONCLUSION = { SUCCESS: 'pass', SKIPPED: 'skip', NEUTRAL: 'skip' };
const outcome = (check) => {
  if (check.status && check.status !== 'COMPLETED') return 'running';
  return CONCLUSION[check.conclusion] ?? 'fail';
};

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

/* ------------------------------------------------------------------------ stage helpers */

const MARK = { done: '✓', pass: '✓', fail: '✗', doing: '…', running: '…', todo: '·', skip: '–' };
const isSet = (entry) => Boolean(entry) && entry.status !== 'todo';
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "✓ detail  (date)" for a recorded stage, "· empty" otherwise. */
function stageText(entry, empty) {
  if (!isSet(entry)) return `· ${empty}`;
  const date = entry.updated ? `  (${entry.updated})` : '';
  return `${MARK[entry.status]} ${entry.detail || entry.status}${date}`;
}

/** One mark for the CI unit-test jobs: all pass ✓, any fail ✗, otherwise running. */
function unitMark(unit) {
  const runs = OS.map((os) => unit[os]).filter(Boolean);
  if (!runs.length) return null;
  if (runs.every((run) => run === 'pass')) return '✓';
  if (runs.some((run) => run === 'fail')) return '✗';
  return '…';
}

/** The Dev Build mark and text: the workbook entry, else the branch's rows in the check log. */
function devBuildState(stage, { pass, fail }) {
  if (isSet(stage)) return { mark: MARK[stage.status], text: stageText(stage, '') };
  if (fail)
    return { mark: '✗', text: `✗ ${fail} failed, ${pass} passed (see docs/dev-build-checks.md)` };
  if (pass) return { mark: '✓', text: `✓ ${pass} checks passed` };
  return { mark: '·', text: '· no checks logged' };
}

const MERGE_LONG = {
  CLEAN: '✓ ready to merge',
  UNKNOWN: '· GitHub is still checking (run again in a minute)',
  UNSTABLE: '◐ mergeable, some checks not green',
  BEHIND: '◐ behind main: update the branch',
  BLOCKED: '✗ blocked (checks or comments)',
  DIRTY: '✗ merge conflicts',
  DRAFT: '◐ draft',
};
const mergeText = (table, state) => table[state] ?? `· ${String(state).toLowerCase()}`;
const reviewText = (open) => (open ? `✗ ${plural(open, 'open comment')}` : '✓ no open comments');

/** Dev: the workbook's Dev entry when recorded, always with the PR state. */
function devText(f, dev) {
  const pr = f.isDraft ? 'draft PR' : 'PR open';
  if (isSet(dev)) return `${stageText(dev, '')} · ${pr}, ${plural(f.commits, 'commit')}`;
  const lead = f.isDraft ? '◐ draft PR' : '● PR open, ready for review';
  return `${lead}, ${plural(f.commits, 'commit')}`;
}

/* --------------------------------------------------------------------------------- render */

const row = (label, text) => `  ${label.padEnd(14)} ${text}`;

/** One feature as a short block of aligned lines. */
export function renderFeature(f) {
  const lines = [`#${f.number}  ${f.title}  (${f.branch})`];
  if (f.state === 'MERGED')
    return [...lines, row('Dev', `✓ merged ${dateOf(f.mergedAt)}`)].join('\n');
  const stages = f.workbook?.stages ?? {};
  const unit = unitMark(f.ci.unit);
  const unitText = unit
    ? `${unit} CI ${OS.filter((os) => f.ci.unit[os])
        .map((os) => `${os} ${MARK[f.ci.unit[os]]}`)
        .join(' ')}`
    : stageText(stages['Unit tests'], 'CI not run yet');
  const quality = f.ci.quality ? `${MARK[f.ci.quality]} SonarCloud` : '· SonarCloud not run yet';
  return [
    ...lines,
    row('Dev', devText(f, stages.Dev)),
    ...(f.workbook
      ? []
      : [row('Workbook', `✗ missing: ${workbookPath(f.branch).replaceAll('\\', '/')}`)]),
    row('Design', stageText(stages.Design, 'not recorded')),
    row('Unit tests', unitText),
    row('Quality', quality),
    row('E2E', stageText(stages.E2E, 'not recorded')),
    row('Dev Build', devBuildState(stages['Dev Build'], f.devBuild).text),
    row('Screen review', stageText(stages['Screen review'], 'not recorded')),
    row('Review', reviewText(f.openComments)),
    row('Mergeable', mergeText(MERGE_LONG, f.mergeState)),
  ].join('\n');
}

const dateOf = (iso) => String(iso ?? '').slice(0, 10);

/** A merged feature on one line. */
export const renderMerged = (f) => `✓ #${f.number}  ${f.title}  merged ${dateOf(f.mergedAt)}`;

/* ------------------------------------------------------------------- colour and table */

const ESC = String.fromCodePoint(27);
const COLOUR = { '✓': 32, '✗': 31, '…': 33, '◐': 33, '·': 90, '–': 90 };

/** Colours standalone marks: green done, red problem, yellow in progress, grey not yet. */
export function paint(text, colour) {
  if (!colour) return text;
  return text.replaceAll(
    /(^|\s)([✓✗…◐·–])(?=\s|$)/g,
    (_match, before, mark) => `${before}${ESC}[${COLOUR[mark]}m${mark}${ESC}[39m`,
  );
}
const bold = (text, colour) => (colour ? `${ESC}[1m${text}${ESC}[22m` : text);

const CHECKPOINTS = ['Design', 'Dev', 'Unit', 'Qual', 'E2E', 'DevB', 'Screen', 'Review'];
const INDENT = '     ';
const WIDTH = 80;

/** The checkpoint marks of one feature, in CHECKPOINTS order. */
function checkpointMarks(f) {
  const stages = f.workbook?.stages ?? {};
  const mark = (entry) => (isSet(entry) ? MARK[entry.status] : '·');
  return [
    mark(stages.Design),
    mark(stages.Dev),
    unitMark(f.ci.unit) ?? mark(stages['Unit tests']),
    f.ci.quality ? MARK[f.ci.quality] : '·',
    mark(stages.E2E),
    devBuildState(stages['Dev Build'], f.devBuild).mark,
    mark(stages['Screen review']),
    f.openComments ? `✗${f.openComments}` : '✓',
  ];
}

/** What stops a feature from merging, in checkpoint order: { text, running }. */
function blockers(f) {
  const stages = f.workbook?.stages ?? {};
  const unit = unitMark(f.ci.unit);
  const quality = f.ci.quality;
  const failedStages = ['E2E', 'Dev Build'].filter((stage) => stages[stage]?.status === 'fail');
  return [
    !f.workbook && { text: 'no workbook' },
    unit === '✗' && { text: 'unit tests failing' },
    unit === '…' && { text: 'unit tests running', running: true },
    quality === 'fail' && { text: 'SonarCloud failing' },
    quality === 'running' && { text: 'SonarCloud running', running: true },
    ...failedStages.map((stage) => ({ text: `${stage} failing` })),
    f.openComments > 0 && { text: plural(f.openComments, 'open comment') },
    f.mergeState === 'DIRTY' && { text: 'merge conflicts' },
    f.mergeState === 'BEHIND' && { text: 'behind main' },
    f.isDraft && { text: 'draft' },
  ].filter(Boolean);
}

/** "✓ ready to merge", "… waiting: …" or "✗ blocked: …". */
function verdict(f) {
  const reasons = blockers(f);
  const list = reasons.map((reason) => reason.text).join(', ');
  if (reasons.some((reason) => !reason.running)) return `✗ blocked: ${list}`;
  if (reasons.length) return `… waiting: ${list}`;
  if (f.mergeState === 'CLEAN') return '✓ ready to merge';
  return mergeText(MERGE_LONG, f.mergeState);
}

const fit = (text) =>
  [...text].length > WIDTH ? `${[...text].slice(0, WIDTH - 1).join('')}…` : text;

/** One open feature in three short lines: name, checkpoints, verdict (each within 80 columns). */
export function overviewRows(f) {
  const marks = checkpointMarks(f);
  const checks = CHECKPOINTS.map((name, index) => `${name} ${marks[index]}`).join('  ');
  return [
    fit(`#${f.number}  ${f.title}`),
    fit(`${INDENT}${checks}`),
    fit(`${INDENT}→ ${verdict(f)}`),
  ];
}

/* ----------------------------------------------------------------- live data (gh, git) */

const TOOL_PATHS = {
  gh: {
    win32: [String.raw`C:\Program Files\GitHub CLI\gh.exe`],
    darwin: ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'],
    linux: ['/usr/bin/gh', '/usr/local/bin/gh'],
  },
  git: {
    win32: [String.raw`C:\Program Files\Git\cmd\git.exe`],
    darwin: ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'],
    linux: ['/usr/bin/git', '/usr/local/bin/git'],
  },
};

/** The absolute path of `gh` or `git`: <NAME>_PATH (absolute) or its usual install location. */
export function resolveTool(
  name,
  env = process.env,
  exists = existsSync,
  platform = process.platform,
) {
  const variable = `${name.toUpperCase()}_PATH`;
  const override = env[variable];
  if (override) {
    if (!isAbsolute(override)) throw new Error(`${variable} must be an absolute path`);
    return override;
  }
  const found = (TOOL_PATHS[name]?.[platform] ?? []).find((path) => exists(path));
  if (!found)
    throw new Error(`${name} was not found where it is usually installed; set ${variable}`);
  return found;
}

const run = (tool, args) =>
  execFileSync(resolveTool(tool), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const PR_FIELDS = `fragment pr on PullRequest {
  number title headRefName headRefOid isDraft state mergeStateStatus mergedAt
  commits(last: 1) { totalCount nodes { commit { statusCheckRollup { contexts(first: 30) { nodes {
    ... on CheckRun { name status conclusion }
  } } } } } }
  reviewThreads(first: 100) { nodes { isResolved } }
}`;

/** The GraphQL query: one PR by number, or the open PRs and the 3 most recently merged. */
export function prQuery(number) {
  const body = number
    ? `one: pullRequest(number: ${Number(number)}) { ...pr }`
    : [
        'open: pullRequests(states: OPEN, first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ...pr } }',
        'merged: pullRequests(states: MERGED, first: 3, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ...pr } }',
      ].join('\n');
  return `query($owner: String!, $name: String!) {\n  repository(owner: $owner, name: $name) {\n${body}\n  }\n}\n${PR_FIELDS}`;
}

function fileAt(nameWithOwner, path, ref) {
  try {
    return run('gh', [
      'api',
      `repos/${nameWithOwner}/contents/${path}?ref=${ref}`,
      '-H',
      'Accept: application/vnd.github.raw',
    ]);
  } catch {
    return null;
  }
}

function toFeature(pr, nameWithOwner) {
  const checks = pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  const open = pr.state !== 'MERGED';
  const workbook = open
    ? fileAt(nameWithOwner, workbookPath(pr.headRefName).replaceAll('\\', '/'), pr.headRefOid)
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
}

function features(number) {
  const nameWithOwner = run('gh', [
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner',
  ]).trim();
  const [owner, name] = nameWithOwner.split('/');
  const query = prQuery(number);
  const data = JSON.parse(
    run('gh', [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-F',
      `owner=${owner}`,
      '-F',
      `name=${name}`,
    ]),
  ).data.repository;
  const prs = number ? [data.one].filter(Boolean) : [...data.open.nodes, ...data.merged.nodes];
  return prs.map((pr) => toFeature(pr, nameWithOwner));
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
  const branch = run('git', ['branch', '--show-current']).trim();
  const path = workbookPath(branch);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const date = new Date().toISOString().slice(0, 10);
  const next = setStage(current, { title: title ?? branch, branch }, stage, status, detail, date);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
  console.log(`${path}: ${stage} → ${status} (${detail}). Commit it with the work.`);
}

function printSummary(list, colour, detailed) {
  const out = (text = '') => console.log(paint(text, colour));
  const open = list.filter((f) => f.state !== 'MERGED');
  const merged = list.filter((f) => f.state === 'MERGED');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  console.log(bold(`Build summary — ${stamp}`, colour));
  out();
  if (!list.length) out('No pull requests found.');
  for (const feature of open) {
    const [title, ...rest] = overviewRows(feature);
    console.log(bold(title, colour));
    rest.forEach((line) => out(line));
    if (detailed)
      renderFeature(feature)
        .split('\n')
        .slice(1)
        .forEach((line) => out(line));
    out();
  }
  if (merged.length) {
    console.log(bold('Recently merged', colour));
    merged.forEach((feature) => out(`  ${renderMerged(feature)}`));
    out();
  }
  out('✓ done  ✗ problem  … in progress  ◐ partly  · not yet  – not needed');
}

function main(args) {
  if (args[0] === 'record') return record(args.slice(1));
  // Colour only in a real terminal: piped or pasted output stays plain text.
  const colour =
    Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !args.includes('--plain');
  const number = args.find((arg) => /^\d+$/.test(arg));
  // One PR asked for by number also gets its full details.
  printSummary(features(number ? Number(number) : null), colour, Boolean(number));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main(process.argv.slice(2));
