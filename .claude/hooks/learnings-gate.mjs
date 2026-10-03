#!/usr/bin/env node
// Stop hook: before Claude finishes a turn that changed code, make sure lessons from the run were
// recorded in docs/LEARNINGS.md. Blocks the stop once with instructions; never loops
// (stop_hook_active) and stays silent for turns that changed nothing.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LEARNINGS = 'docs/LEARNINGS.md';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  /* no stdin */
}
if (input.stop_hook_active) process.exit(0);

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const changed = git('status', '--porcelain')
  .split('\n')
  .map((l) => l.slice(3).trim())
  .filter(Boolean);
if (changed.includes(LEARNINGS)) process.exit(0); // already being recorded this run

const lastLearnings = git('log', '-1', '--format=%H', '--', LEARNINGS);
const commitsSince = lastLearnings ? git('rev-list', '--count', `${lastLearnings}..HEAD`) : git('rev-list', '--count', 'HEAD');
const codeChanged = changed.some((f) => !f.startsWith('docs/')) || Number(commitsSince || 0) > 0;
if (!codeChanged) process.exit(0);

process.stdout.write(
  JSON.stringify({
    decision: 'block',
    reason:
      `Before finishing: record what this run learned in ${LEARNINGS} (append dated entries under the right section: ` +
      'what went wrong or was slow, the root cause, and the rule that prevents it next time). Only real, ' +
      're-usable lessons — skip if the run taught nothing new, but then add a one-line "no new lessons" entry so ' +
      'this gate is satisfied. If a lesson changes how agents must work in this repo, also update the rule in ' +
      'CLAUDE.md (AGENTS.md points to it). Keep entries short.',
  }),
);
