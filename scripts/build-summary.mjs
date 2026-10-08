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

/* ------------------------------------------------------------------- colour and table */

const ESC = String.fromCharCode(27);
const COLOUR = { '✓': 32, '✗': 31, '…': 33, '◐': 33, '·': 90, '–': 90 };

/** Colours standalone marks: green done, red problem, yellow in progress, grey not yet. */
export function paint(text, colour) {
  if (!colour) return text;
  return text.replace(
    /(^|\s)([✓✗…◐·–])(?=\s|$)/g,
    (_match, before, mark) => `${before}${ESC}[${COLOUR[mark]}m${mark}${ESC}[39m`,
  );
}
const bold = (text, colour) => (colour ? `${ESC}[1m${text}${ESC}[22m` : text);

const COLUMNS = [
  ['Design', 6],
  ['Dev', 3],
  ['Unit', 4],
  ['Qual', 4],
  ['E2E', 3],
  ['DevB', 4],
  ['Screen', 6],
  ['Review', 6],
];
const MERGE_SHORT = {
  CLEAN: '✓ ready',
  BLOCKED: '✗ blocked',
  DIRTY: '✗ conflicts',
  BEHIND: '◐ behind',
  UNSTABLE: '◐ unstable',
  DRAFT: '◐ draft',
  UNKNOWN: '· checking',
};

/** The overview marks of one feature, in COLUMNS order, then Merge. */
function overviewMarks(f) {
  const stages = f.workbook?.stages ?? {};
  const mark = (entry) => (entry && entry.status !== 'todo' ? MARK[entry.status] : '·');
  const runs = OS.map((os) => f.ci.unit[os]).filter(Boolean);
  const unit = runs.length
    ? runs.every((run) => run === 'pass')
      ? '✓'
      : runs.some((run) => run === 'fail')
        ? '✗'
        : '…'
    : mark(stages['Unit tests']);
  const devBuild =
    stages['Dev Build'] && stages['Dev Build'].status !== 'todo'
      ? mark(stages['Dev Build'])
      : f.devBuild.fail
        ? '✗'
        : f.devBuild.pass
          ? '✓'
          : '·';
  return [
    mark(stages.Design),
    mark(stages.Dev),
    unit,
    f.ci.quality ? MARK[f.ci.quality] : '·',
    mark(stages.E2E),
    devBuild,
    mark(stages['Screen review']),
    f.openComments ? `✗ ${f.openComments}` : '✓',
    MERGE_SHORT[f.mergeState] ?? `· ${String(f.mergeState).toLowerCase()}`,
  ];
}

const centre = (text, width) => {
  const left = Math.floor((width - [...text].length) / 2);
  return `${' '.repeat(left)}${text}`.padEnd(width);
};

/** Open features as a bordered table that fits `width` columns (the feature title is shortened). */
export function overviewRows(features, width = 120) {
  const headers = ['PR', 'Feature', ...COLUMNS.map(([name]) => name), 'Merge'];
  const fixed = [4, ...COLUMNS.map(([, size]) => size), 11];
  const borders = 3 * headers.length + 1;
  const titleWidth = Math.max(20, width - borders - fixed.reduce((sum, size) => sum + size, 0));
  const widths = [fixed[0], titleWidth, ...fixed.slice(1)];
  const short = (title) =>
    [...title].length > titleWidth ? `${[...title].slice(0, titleWidth - 1).join('')}…` : title;
  const line = (cells) =>
    `│ ${cells
      .map((cell, index) =>
        index > 1 && index < cells.length - 1
          ? centre(cell, widths[index])
          : cell.padEnd(widths[index]),
      )
      .join(' │ ')} │`;
  const rule = (left, middle, right) =>
    `${left}${widths.map((size) => '─'.repeat(size + 2)).join(middle)}${right}`;
  return [
    rule('┌', '┬', '┐'),
    line(headers),
    rule('├', '┼', '┤'),
    ...features.map((f) => line([`#${f.number}`, short(f.title), ...overviewMarks(f)])),
    rule('└', '┴', '┘'),
  ];
}

/** A merged feature on one line. */
export const renderMerged = (f) =>
  `✓ #${f.number}  ${f.title}  merged ${String(f.mergedAt ?? '').slice(0, 10)}`;

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
  // Colour only in a real terminal: piped or pasted output stays plain text.
  const colour =
    Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !args.includes('--plain');
  const width = Math.min(Math.max(process.stdout.columns || 120, 100), 160);
  const number = args.find((arg) => /^\d+$/.test(arg));
  const list = features(number ? Number(number) : null);
  const open = list.filter((f) => f.state !== 'MERGED');
  const merged = list.filter((f) => f.state === 'MERGED');
  const out = (text = '') => console.log(paint(text, colour));
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

  console.log(bold(`Build summary — ${stamp}`, colour));
  out();
  if (!list.length) out('No pull requests found.');
  if (open.length) {
    for (const line of overviewRows(open, width)) out(line);
    out();
    for (const feature of open) {
      const [title, ...details] = renderFeature(feature).split('\n');
      console.log(bold(title, colour));
      for (const line of details) out(line);
      out();
    }
  }
  if (merged.length) {
    console.log(bold('Recently merged', colour));
    for (const feature of merged) out(`  ${renderMerged(feature)}`);
    out();
  }
  out('✓ done  ✗ problem  … in progress  ◐ partly  · not yet  – not needed');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main(process.argv.slice(2));
