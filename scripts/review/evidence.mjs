// Release review: test evidence, counted only for the commit it checked.
import { classifyFile, isNeutral } from './components.mjs';

const OK = ['done', 'pass'];

/**
 * The PR's own change per file from `git diff -U0 <merge base> <commit>`: only the added and removed
 * lines (and new/deleted file modes), so hunk positions that move when `main` changes the same file do
 * not count. A binary file is keyed by its blob ids.
 */
export function ownChanges(diffText) {
  const out = new Map();
  for (const part of diffText.split(/^(?=diff --git )/m)) {
    const path = part.match(/^diff --git a\/.+? b\/(.+)$/m)?.[1];
    if (!path) continue;
    const lines = part.split('\n');
    const key = /^Binary files /m.test(part)
      ? lines.filter((l) => l.startsWith('index ')).join('\n')
      : lines
          .filter((l) => /^(?:new|deleted) file mode /.test(l) || /^[+-](?![+-]{2} )/.test(l))
          .join('\n');
    out.set(path, key);
  }
  return out;
}

const TEST_FILE = /(?:^|\/)(?:e2e|test)\/|\.test\./;

/**
 * True when a change to `path` can change a test result: code (critical/core/noncore), pipeline and
 * test files. Docs (notes, mocks, CHANGELOG, AGENTS.md) and the neutral logs cannot.
 */
export const resetsEvidence = (map, path) =>
  !isNeutral(map, path) && (classifyFile(map, path).tier !== 'docs' || TEST_FILE.test(path));

/**
 * The PR's files that can change a test result whose own change differs between two commits of the PR (each a
 * `git diff -U0` from its merge base with `main`): files that only came in from `main` are not the
 * PR's and do not count. Null = not known.
 */
export function ownDiffChanges(before, after, map) {
  if (typeof before !== 'string' || typeof after !== 'string') return null;
  const [a, b] = [ownChanges(before), ownChanges(after)];
  return [...new Set([...a.keys(), ...b.keys()])]
    .filter((path) => resetsEvidence(map, path) && a.get(path) !== b.get(path))
    .sort((x, y) => x.localeCompare(y));
}

/** e2e and screen review from the workbook stages (see build-summary.mjs). The link check comes from CI. */
export function workbookEvidence(workbook, isValid) {
  const stage = (name) => workbook?.stages?.[name];
  const okStage = (name) => {
    const s = stage(name);
    return Boolean(s && OK.includes(s.status) && isValid(s.commit));
  };
  const e2e = okStage('E2E');
  return {
    e2e: { ok: e2e, sha: stage('E2E')?.commit ?? '', detail: stage('E2E')?.detail ?? '' },
    screenReview: {
      ok: okStage('Screen review'),
      sha: stage('Screen review')?.commit ?? '',
      detail: stage('Screen review')?.detail ?? '',
    },
  };
}

const cellsOf = (line) =>
  line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());

/** Table rows of docs/dev-build-checks.md: the commits named in the Build cell and a real-part marker. */
export function devBuildRows(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    if (!/^\| \d{4}-\d{2}-\d{2} /.test(line)) continue;
    const cells = cellsOf(line);
    const shas = [...(cells[1] ?? '').matchAll(/`([0-9a-f]{7,40})`/g)].map((m) => m[1]);
    rows.push({ cells, shas, real: /\breal:/i.test(line) });
  }
  return rows;
}

/** The Dev Build check and the real-part test for a commit that `isValid` accepts. */
export function devBuildEvidence(rows, isValid) {
  const valid = rows.filter((row) => row.shas.some((sha) => isValid(sha)));
  return { devBuild: valid.length > 0, realTest: valid.some((row) => row.real) };
}

/** Percentage from the CI line of scripts/changed-lines-coverage.mjs; null when absent. */
export function coverageFromLog(text) {
  if (/changed-lines coverage: no changed executable lines/.test(text)) return 100;
  const m = text.match(/changed-lines coverage: ([\d.]+) %/);
  return m ? Number(m[1]) : null;
}

/**
 * The desktop link check from CI: the Windows job of the head ran `npm run e2e:electron-links`
 * (every external link on every screen in the real Electron window) and that step passed.
 * `job` is the Actions job (`GET actions/jobs/<id>`) with its steps.
 */
export function ciLinkCheck(job) {
  return Boolean(
    job?.steps?.some(
      (step) => /e2e:electron-links/.test(step.name ?? '') && step.conclusion === 'success',
    ),
  );
}

/** Resolved state of a review thread: GraphQL `isResolved`, or the REST shapes of the CCR route. */
const resolvedOf = (thread) => thread.isResolved ?? thread.is_resolved ?? thread.resolved;

/** Review comments of the PR: `total` comments, `open` unresolved threads (null = not known). */
export function reviewCommentCounts(comments, threads) {
  const known = Array.isArray(threads) && threads.every((t) => typeof resolvedOf(t) === 'boolean');
  return {
    total: comments.length,
    open: known ? threads.filter((thread) => !resolvedOf(thread)).length : null,
  };
}

/**
 * Required checks of the head by name (`map.requiredChecks`): the newest run of each name decides.
 * `state` is green only when every one passed; `missing`, `pending` and `failed` name the others.
 */
export function requiredChecks(runs, names, green = ['success', 'skipped', 'neutral']) {
  const out = { missing: [], pending: [], failed: [] };
  for (const name of names) {
    const run = runs
      .filter((r) => r.name === name)
      .sort(
        (x, y) =>
          String(y.started_at ?? '').localeCompare(String(x.started_at ?? '')) || y.id - x.id,
      )[0];
    if (!run) out.missing.push(name);
    else if (run.status !== 'completed') out.pending.push(name);
    else if (!green.includes(run.conclusion)) out.failed.push(name);
  }
  let state = 'green';
  if (out.failed.length) state = 'failed';
  else if (out.pending.length || out.missing.length) state = 'pending';
  return { state, ...out };
}
