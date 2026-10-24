// Release review: the review log entry, the PR comment, the permanent index and where the log goes.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SHARED_LOG = 'docs/release-review/log.md';
export const INDEX = 'docs/release-review/index.md';
const INDEX_HEAD = '| Date | PR | Commit | Tier | Score | Decision | Log |';

const sign = (n) => (n > 0 ? `+${n}` : String(n));

/** One log entry; the same Markdown is the PR comment. */
export function renderEntry({ date, pr, sha, result, migrationNote = '' }) {
  const lines = [
    `## ${date} · PR #${pr} · \`${sha}\` · ${result.decision} (${result.score})`,
    '',
    `Tier **${result.tier}**, set by: ${result.tierFiles.slice(0, 8).join(', ') || '—'}` +
      (result.tierFiles.length > 8 ? ` and ${result.tierFiles.length - 8} more` : ''),
    '',
  ];
  if (result.items.length) {
    lines.push('| Item | Points | Proof |', '| --- | --- | --- |', `| Start | 50 | |`);
    for (const item of result.items)
      lines.push(`| ${item.label} | ${sign(item.points)} | ${item.ok ? '✓' : '✗ missing'} |`);
    lines.push(`| **Score** | **${result.score}** | |`, '');
  } else lines.push('Only docs, tests or pipeline files changed.', '');
  lines.push(
    result.hardStops.length
      ? `Hard stops: ${result.hardStops.map((h) => `${h.id}. ${h.reason}`).join('; ')}`
      : 'Hard stops: none',
  );
  if (migrationNote) lines.push('', `Migration: ${migrationNote}`);
  lines.push('', `Decision: **${result.decision}**`, '');
  return lines.join('\n');
}

export const renderApproval = ({ date, pr, sha, quote }) =>
  [`## ${date} · PR #${pr} · \`${sha}\` · approved by the owner`, '', `> ${quote}`, ''].join('\n');

export const indexRow = ({ date, pr, sha, tier, score, decision, logPath }) =>
  `| ${date} | #${pr} | \`${sha}\` | ${tier} | ${score} | ${decision} | ${logPath} |`;

export function parseIndex(markdown) {
  return markdown
    .split('\n')
    .filter((line) => /^\| \d{4}-\d{2}-\d{2} \| #\d+/.test(line))
    .map((line) => {
      const [date, pr, sha, tier, score, decision, logPath] = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      return {
        date,
        pr: Number(pr.slice(1)),
        sha: sha.replaceAll('`', ''),
        tier,
        score: Number(score),
        decision,
        logPath,
      };
    });
}

/** The feature folder's review.md (Feature: line, then the branch name), else the shared log. */
export function logPathFor({ workbookMarkdown, branch, featureFolders }) {
  const named = workbookMarkdown?.match(/^Feature: `?([\w.-]+)`?/m)?.[1];
  const fromBranch = branch.replace(/^(?:feat|fix|docs|chore|refactor|build|ci|test)\//, '');
  const folder = [named, fromBranch].find((name) => name && featureFolders.includes(name));
  return folder ? `docs/features/${folder}/review.md` : SHARED_LOG;
}

/** Append only: old entries are never rewritten. */
export function appendEntry(path, entry, header = '# Review log\n') {
  mkdirSync(dirname(path), { recursive: true });
  const current = existsSync(path) ? readFileSync(path, 'utf8') : `${header}\n`;
  writeFileSync(path, `${current.trimEnd()}\n\n${entry.trimEnd()}\n`);
}

export function appendIndexRow(path, row) {
  const head = `# Release review index\n\nEvery release review run, newest last. Never pruned.\n\n${INDEX_HEAD}\n| --- | --- | --- | --- | --- | --- | --- |\n`;
  mkdirSync(dirname(path), { recursive: true });
  const current = existsSync(path) ? readFileSync(path, 'utf8') : head;
  writeFileSync(path, `${current.trimEnd()}\n${row}\n`);
}
