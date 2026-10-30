// Release review: test evidence, counted only for the commit it checked.
import { isNeutral } from './components.mjs';

const OK = ['done', 'pass'];

/**
 * Evidence recorded at `sha` still holds at the head when every file changed since `sha` is
 * neutral (workbook, logs, Dev Build log, screenshots, LEARNINGS): recording a stage is itself a commit.
 */
export function evidenceShaValid(sha, changedFilesSince, map) {
  if (!sha) return false;
  const files = changedFilesSince(sha);
  if (files === null) return false;
  return files.every((path) => isNeutral(map, path));
}

/** e2e, link check and screen review from the workbook stages (see build-summary.mjs). */
export function workbookEvidence(workbook, isValid) {
  const stage = (name) => workbook?.stages?.[name];
  const okStage = (name) => {
    const s = stage(name);
    return Boolean(s && OK.includes(s.status) && isValid(s.commit));
  };
  const e2e = okStage('E2E');
  return {
    e2e: { ok: e2e, sha: stage('E2E')?.commit ?? '', detail: stage('E2E')?.detail ?? '' },
    linkCheck: {
      ok: e2e && /electron-links/.test(stage('E2E')?.detail ?? ''),
      sha: stage('E2E')?.commit ?? '',
      detail: stage('E2E')?.detail ?? '',
    },
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
