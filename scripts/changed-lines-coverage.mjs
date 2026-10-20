#!/usr/bin/env node
// Good-to-go gate: at least 90 % of the executable lines a branch adds or changes are covered by tests.
// Reads coverage/coverage-final.json (run `npm run test:coverage` first) and `git diff --unified=0` against
// the base (BASE_REF, default origin/main). A line counts when a statement starts on it; lines outside the
// coverage include list (tests, docs, configs) are ignored. Usage:
//   node scripts/changed-lines-coverage.mjs [--min 90] [--base origin/main] [--report coverage/coverage-final.json]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveTool } from './build-summary.mjs';

/** Added/changed line numbers per file from `git diff --unified=0` output. Pure (tested). */
export function changedLines(diff) {
  const out = new Map();
  let file = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line === '+++ /dev/null' ? null : line.slice(6);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || !file) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const lines = out.get(file) ?? new Set();
    for (let n = start; n < start + count; n++) lines.add(n);
    out.set(file, lines);
  }
  return out;
}

/**
 * Covered and uncovered changed executable lines. `coverage` is istanbul's coverage-final.json keyed by
 * repo-relative paths (forward slashes); a line is executable when a statement starts on it. Pure (tested).
 */
export function changedCoverage(changed, coverage) {
  const covered = [];
  const uncovered = [];
  for (const [file, lines] of changed) {
    const fc = coverage[file];
    if (!fc) continue;
    const hits = new Map();
    for (const [id, loc] of Object.entries(fc.statementMap)) {
      const n = loc.start.line;
      hits.set(n, (hits.get(n) ?? 0) + (fc.s[id] ?? 0));
    }
    for (const n of lines) {
      if (!hits.has(n)) continue;
      (hits.get(n) > 0 ? covered : uncovered).push(`${file}:${n}`);
    }
  }
  return { covered, uncovered };
}

/** Source files the coverage gate must see (the vitest.config.ts include list, minus tests). Pure (tested). */
export function isSourceFile(path) {
  return (
    /^(packages|apps)\/[^/]+\/src\/.+\.(ts|tsx|cts)$/.test(path) &&
    !/\.test\.|\.d\.ts$|\/test\/|\/locales\//.test(path)
  );
}

/** Changed source files with no entry in the report: they must not pass unmeasured. Pure (tested). */
export function missingSourceFiles(changed, coverage) {
  return [...changed.keys()].filter((f) => isSourceFile(f) && !coverage[f]);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const min = Number(arg('--min', '90'));
  const base = arg('--base', process.env.BASE_REF || 'origin/main');
  const reportPath = arg('--report', 'coverage/coverage-final.json');
  if (!existsSync(reportPath)) {
    console.error(`${reportPath} is missing: run npm run test:coverage first`);
    process.exit(2);
  }
  const root = process.cwd();
  const raw = JSON.parse(readFileSync(reportPath, 'utf8'));
  const coverage = Object.fromEntries(
    Object.entries(raw).map(([abs, v]) => [relative(root, abs).replaceAll('\\', '/'), v]),
  );
  // An empty report (wrong include, a filtered run) would pass every change: refuse it.
  if (Object.keys(coverage).length === 0) {
    console.error(`${reportPath} has no files: run the full npm run test:coverage`);
    process.exit(2);
  }
  // git from its usual install path (or GIT_PATH), never a PATH lookup.
  const diff = execFileSync(
    resolveTool('git'),
    ['diff', '--unified=0', '--no-color', `${base}...HEAD`],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const changed = changedLines(diff);
  const missing = missingSourceFiles(changed, coverage);
  if (missing.length) {
    console.log(
      'Changed source files missing from the coverage report:\n  ' + missing.join('\n  '),
    );
    process.exit(1);
  }
  const { covered, uncovered } = changedCoverage(changed, coverage);
  const total = covered.length + uncovered.length;
  if (total === 0) {
    console.log('changed-lines coverage: no changed executable lines');
    process.exit(0);
  }
  const pct = (100 * covered.length) / total;
  console.log(
    `changed-lines coverage: ${pct.toFixed(1)} % (${covered.length}/${total} lines, minimum ${min} %)`,
  );
  if (pct < min) {
    console.log('Uncovered changed lines:\n  ' + uncovered.join('\n  '));
    process.exit(1);
  }
}
