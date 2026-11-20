#!/usr/bin/env node
// PreToolUse hook (mcp__github__merge_pull_request, mcp__github__enable_pr_auto_merge, Bash): enforces the merge
// rule of AGENTS.md. A merge needs the owner's merge word in his newest real message, or (this repository only) a
// final check `node scripts/release-review.mjs <pr>` that prints `MERGE OK` with risk:auto / risk:pipeline.
// Never allowed: GitHub auto-merge, `gh pr merge`, a push to main/master. Fails closed (exit 2 with the reason).
// Reads and every other tool pass. Node only. Design: docs/superpowers/specs/2026-10-24-release-review-design.md §9.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MERGE_TOOL = 'mcp__github__merge_pull_request';
export const AUTO_MERGE_TOOL = 'mcp__github__enable_pr_auto_merge';

/** Text of a real user message, or '' for tool results, synthetic and system entries. */
export function userText(entry) {
  const m = entry?.message;
  if (entry?.type !== 'user' || m?.role !== 'user' || entry.isMeta || entry.isSynthetic) return '';
  if (typeof m.content === 'string') return realText(m.content);
  if (!Array.isArray(m.content)) return '';
  if (m.content.some((b) => b?.type === 'tool_result')) return '';
  return m.content
    .filter((b) => b?.type === 'text')
    .map((b) => realText(b.text))
    .join('\n');
}

/** Harness-injected text (system reminders, notifications) is not the owner's. */
function realText(text) {
  if (typeof text !== 'string') return '';
  if (/^\s*<(system-reminder|task-notification|command-name|local-command)/.test(text)) return '';
  if (/^\s*\[SYSTEM NOTIFICATION/.test(text)) return '';
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

/** The newest real user message of a JSONL transcript ('' when there is none). */
export function newestUserMessage(jsonl) {
  const lines = String(jsonl).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const text = userText(entry);
    if (text) return text;
  }
  return '';
}

/** Does the owner's message carry the merge word for PR `n`? `release` = a release PR (needs "and release"). */
export function hasMergeWord(message, n, { release = false } = {}) {
  const num = String(n);
  const re = /\bmerge\b([^.!?\n]*)/gi;
  const text = String(message);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const rest = m[1];
    if (release && !/\band release\b/i.test(rest)) continue;
    // "merge 401, 390 and #388": the list of numbers right after the word (an optional "PR" in between).
    const list = rest.match(
      /^\s*(?:(?:prs?|pull requests?)\s+)?((?:#?\d+(?:\s*(?:,|and|&)\s*|\s+(?=#?\d)))*#?\d+)/i,
    );
    if (list && list[1].match(/\d+/g).includes(num)) return true;
  }
  return false;
}

/** A Bash command that merges or pushes to the default branch. Returns a reason or null. */
export function bashViolation(command) {
  const cmd = String(command ?? '');
  const segments = cmd.split(/&&|\|\||;|\n|\|/);
  for (const raw of segments) {
    const seg = raw.trim();
    if (/(^|[\s"'(`])gh\s+(?:\S+\s+)*?pr\s+merge\b/.test(seg)) return 'gh pr merge is not allowed';
    const push = seg.match(/(^|[\s"'(`])git\s+(?:\S+\s+)*?push\b(.*)$/);
    if (push) {
      const args = push[2]
        .replace(/["'`)]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
      if (args.some((a) => a === '--mirror' || a === '--all'))
        return 'git push --all/--mirror is not allowed';
      const operands = args.filter((a) => !a.startsWith('-'));
      // operands: [remote, refspec...] or [refspec...]; any refspec ending in main/master is refused
      for (const op of operands) {
        const dst = op.includes(':') ? op.split(':').pop() : op;
        const name = dst.replace(/^\+/, '').replace(/^refs\/heads\//, '');
        if (name === 'main' || name === 'master') return 'git push to main/master is not allowed';
      }
    }
  }
  return null;
}

/** First line of the release review output, parsed. */
export function parseVerdict(output) {
  const first =
    String(output)
      .split('\n')
      .find((l) => l.trim()) ?? '';
  const ok = /^MERGE OK\b/.test(first) && /\brisk:(auto|pipeline)\b/.test(first);
  return { ok, line: first.trim() };
}

function sameRepo(input, repo) {
  const owner = String(input.owner ?? '').toLowerCase();
  const name = String(input.repo ?? '').toLowerCase();
  return `${owner}/${name}` === String(repo ?? '').toLowerCase();
}

/**
 * Decide one tool call. `ctx` = { transcript: string, repo: 'owner/name' | null, review: (n) => string | throws,
 * isRelease: (input) => boolean }. Returns { allow: true } or { allow: false, reason }.
 */
export function decide(event, ctx) {
  const tool = event?.tool_name;
  const input = event?.tool_input ?? {};
  if (tool === AUTO_MERGE_TOOL) return deny('GitHub auto-merge is never allowed');
  if (tool === 'Bash') {
    const why = bashViolation(input.command);
    return why ? deny(why) : { allow: true };
  }
  if (tool !== MERGE_TOOL) return { allow: true };
  const n = input.pullNumber;
  if (!Number.isInteger(n)) return deny('merge: no pull request number');
  const message = newestUserMessage(ctx.transcript);
  const release = ctx.isRelease ? ctx.isRelease(input) : false;
  if (hasMergeWord(message, n, { release })) return { allow: true };
  if (release)
    return deny('release PR: needs the owner\'s "merge <n> and release" in his newest message');
  if (!sameRepo(input, ctx.repo)) return deny('no merge word from the owner (other repository)');
  let out;
  try {
    out = ctx.review(n);
  } catch (e) {
    return deny(
      `no merge word from the owner, and the release review failed: ${String(e?.message ?? e).split('\n')[0]}`,
    );
  }
  const v = parseVerdict(out);
  return v.ok
    ? { allow: true }
    : deny(`no merge word from the owner; final check: ${v.line || 'no output'}`);
}

const deny = (reason) => ({ allow: false, reason });

function repoFromRemote(url) {
  const m = String(url).match(/github\.com[:/]([^/]+\/[^/.\s]+?)(?:\.git)?\s*$/);
  return m ? m[1] : null;
}

function run(cwd, cmd, args, timeout) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function main(stdin, deps = {}) {
  let event;
  try {
    event = JSON.parse(stdin || '{}');
  } catch {
    return { code: 2, message: 'merge-gate: unreadable hook input' };
  }
  const tool = event.tool_name;
  if (tool !== MERGE_TOOL && tool !== AUTO_MERGE_TOOL && tool !== 'Bash') return { code: 0 };
  const cwd = event.cwd || process.cwd();
  const read = deps.readFile ?? ((p) => readFileSync(p, 'utf8'));
  let transcript = '';
  try {
    if (event.transcript_path) transcript = read(event.transcript_path);
  } catch {
    transcript = '';
  }
  const exec = deps.exec ?? run;
  let repo;
  try {
    repo = repoFromRemote(exec(cwd, 'git', ['remote', 'get-url', 'origin'], 10000));
  } catch {
    repo = null;
  }
  const ctx = {
    transcript,
    repo,
    review: (n) => exec(cwd, 'node', ['scripts/release-review.mjs', String(n)], 60000),
    isRelease: (input) => {
      if (/^chore\(release\)/i.test(String(input.commit_title ?? ''))) return true;
      try {
        const title = exec(
          cwd,
          'gh',
          ['pr', 'view', String(input.pullNumber), '--json', 'title', '--jq', '.title'],
          15000,
        );
        return /^chore\(release\)/i.test(title.trim());
      } catch {
        return false; // no gh here: the review script itself refuses release PRs, so the auto path stays closed for them
      }
    },
  };
  const r = decide(event, ctx);
  return r.allow ? { code: 0 } : { code: 2, message: `merge-gate: ${r.reason}` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = main(readFileSync(0, 'utf8'));
  if (result.message) process.stderr.write(`${result.message}\n`);
  process.exit(result.code);
}
