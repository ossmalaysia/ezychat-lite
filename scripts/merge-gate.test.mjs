import { describe, expect, it } from 'vitest';
import {
  bashViolation,
  decide,
  hasMergeWord,
  main,
  newestUserMessage,
  parseVerdict,
  userText,
} from '../.claude/hooks/merge-gate.mjs';

const line = (o) => JSON.stringify(o);
const user = (text) => line({ type: 'user', message: { role: 'user', content: text } });
const blocks = (b) => line({ type: 'user', message: { role: 'user', content: b } });
const transcript = (...l) => l.join('\n');
const merge = (n, extra = {}) => ({
  tool_name: 'mcp__github__merge_pull_request',
  tool_input: { owner: 'ossmalaysia', repo: 'ezychat-lite', pullNumber: n, ...extra },
});
const ctx = (over = {}) => ({
  transcript: transcript(user('please fix the thing')),
  repo: 'ossmalaysia/ezychat-lite',
  review: () => 'NOT READY: risk:human',
  isRelease: () => false,
  ...over,
});

describe('transcript parsing', () => {
  it('skips tool results, synthetic entries and injected notifications', () => {
    expect(
      userText({ type: 'assistant', message: { role: 'assistant', content: 'merge 1' } }),
    ).toBe('');
    expect(
      userText({ type: 'user', isMeta: true, message: { role: 'user', content: 'merge 1' } }),
    ).toBe('');
    expect(userText({ type: 'user', message: { role: 'user', content: 5 } })).toBe('');
    expect(userText(JSON.parse(blocks([{ type: 'tool_result', content: 'merge 1' }])))).toBe('');
    expect(
      userText({
        type: 'user',
        message: { role: 'user', content: '[SYSTEM NOTIFICATION] merge 1' },
      }),
    ).toBe('');
    expect(
      userText({ type: 'user', message: { role: 'user', content: '<task-notification>merge 1' } }),
    ).toBe('');
    expect(
      userText({
        type: 'user',
        message: { role: 'user', content: 'hi<system-reminder>merge 1</system-reminder>' },
      }),
    ).toBe('hi');
    expect(
      userText({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'merge 2' }] },
      }),
    ).toBe('merge 2');
  });
  it('takes the newest real user message, ignoring garbage lines', () => {
    const t = transcript(
      user('merge 401'),
      'not json',
      '',
      blocks([{ type: 'tool_result', content: 'x' }]),
      line({ type: 'user', isMeta: true, message: { role: 'user', content: 'merge 9' } }),
    );
    expect(newestUserMessage(t)).toBe('merge 401');
    expect(newestUserMessage('')).toBe('');
  });
});

describe('merge word', () => {
  it('matches the number, also in lists', () => {
    expect(hasMergeWord('merge 401', 401)).toBe(true);
    expect(hasMergeWord('Merge #401', 401)).toBe(true);
    expect(hasMergeWord('merge 401, 390', 390)).toBe(true);
    expect(hasMergeWord('merge 401, 390 and 388', 388)).toBe(true);
    expect(hasMergeWord('merge PR 401', 401)).toBe(true);
    expect(hasMergeWord('merge 401', 390)).toBe(false);
    expect(hasMergeWord('merge the PR', 401)).toBe(false);
    expect(hasMergeWord('do not merge. 401 is fine', 401)).toBe(false);
    expect(hasMergeWord('nothing', 401)).toBe(false);
  });
  it('needs "and release" for a release PR', () => {
    expect(hasMergeWord('merge 403', 403, { release: true })).toBe(false);
    expect(hasMergeWord('merge 403 and release', 403, { release: true })).toBe(true);
  });
});

describe('bash', () => {
  it('denies gh pr merge and pushes to main/master', () => {
    expect(bashViolation('gh pr merge 5 --squash')).toMatch(/gh pr merge/);
    expect(bashViolation('cd x && gh -R a/b pr merge 5')).toMatch(/gh pr merge/);
    expect(bashViolation('git push origin main')).toMatch(/main/);
    expect(bashViolation('git push origin HEAD:main')).toMatch(/main/);
    expect(bashViolation('git push -u origin feature:refs/heads/master')).toMatch(/main/);
    expect(bashViolation('git push --force-with-lease origin +main')).toMatch(/main/);
    expect(bashViolation('git push --all')).toMatch(/--all/);
    expect(bashViolation('git -C /x push origin master')).toMatch(/main/);
    expect(bashViolation('bash -c "git push origin main"')).toMatch(/main/);
  });
  it('lets ordinary commands through', () => {
    expect(bashViolation('git push -u origin docs/auto-merge-policy')).toBeNull();
    expect(bashViolation('git push origin HEAD:feature/main-menu')).toBeNull();
    expect(bashViolation('git status')).toBeNull();
    expect(bashViolation('gh pr view 5')).toBeNull();
    expect(bashViolation(undefined)).toBeNull();
  });
});

describe('final check output', () => {
  it('needs MERGE OK with risk:auto or risk:pipeline', () => {
    expect(parseVerdict('MERGE OK · risk:auto (95)\nmore').ok).toBe(true);
    expect(parseVerdict('MERGE OK · risk:pipeline (90)').ok).toBe(true);
    expect(parseVerdict('MERGE OK · risk:human (60)').ok).toBe(false);
    expect(parseVerdict('NOT READY: checks · risk:auto (90)').ok).toBe(false);
    expect(parseVerdict('').line).toBe('');
  });
});

describe('decide', () => {
  it('never allows GitHub auto-merge', () => {
    const r = decide({ tool_name: 'mcp__github__enable_pr_auto_merge', tool_input: {} }, ctx());
    expect(r.allow).toBe(false);
  });
  it('passes other tools and reads', () => {
    expect(decide({ tool_name: 'Read', tool_input: {} }, ctx())).toEqual({ allow: true });
    expect(decide({ tool_name: 'Bash', tool_input: { command: 'git status' } }, ctx())).toEqual({
      allow: true,
    });
    expect(
      decide({ tool_name: 'Bash', tool_input: { command: 'git push origin main' } }, ctx()).allow,
    ).toBe(false);
  });
  it('allows a merge on the owner’s word', () => {
    expect(decide(merge(401), ctx({ transcript: transcript(user('merge 401, 390')) })).allow).toBe(
      true,
    );
  });
  it('allows this repository on MERGE OK risk:auto', () => {
    const r = decide(merge(7), ctx({ review: () => 'MERGE OK · risk:auto (97)' }));
    expect(r.allow).toBe(true);
  });
  it('denies on NOT READY with the failing line, and on a review error (fail closed)', () => {
    const a = decide(merge(7), ctx({ review: () => 'NOT READY: checks pending · risk:auto (90)' }));
    expect(a).toMatchObject({ allow: false });
    expect(a.reason).toContain('NOT READY: checks pending');
    const b = decide(
      merge(7),
      ctx({
        review: () => {
          throw new Error('timeout\nstack');
        },
      }),
    );
    expect(b.allow).toBe(false);
    expect(b.reason).toContain('release review failed: timeout');
  });
  it('a different repository needs the owner’s word, never the script', () => {
    const e = merge(7, { owner: 'anchorsprint', repo: 'other' });
    const r = decide(e, ctx({ review: () => 'MERGE OK · risk:auto (99)' }));
    expect(r.allow).toBe(false);
    expect(decide(e, ctx({ transcript: transcript(user('merge 7')) })).allow).toBe(true);
  });
  it('a release PR needs "merge <n> and release", never the script', () => {
    const rel = ctx({ isRelease: () => true, review: () => 'MERGE OK · risk:auto (99)' });
    expect(decide(merge(403), rel).allow).toBe(false);
    expect(decide(merge(403), { ...rel, transcript: user('merge 403') }).allow).toBe(false);
    expect(decide(merge(403), { ...rel, transcript: user('merge 403 and release') }).allow).toBe(
      true,
    );
  });
  it('denies a merge without a pull request number', () => {
    expect(
      decide({ tool_name: 'mcp__github__merge_pull_request', tool_input: {} }, ctx()).allow,
    ).toBe(false);
  });
  it('an owner’s old word does not carry over to a newer message', () => {
    const t = transcript(user('merge 401'), user('now fix the tests'));
    expect(decide(merge(401), ctx({ transcript: t })).allow).toBe(false);
  });
});

describe('main (hook entry)', () => {
  const calls = [];
  const deps = (over = {}) => ({
    readFile: () => transcript(user('hello')),
    exec: (cwd, cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'git') return 'https://github.com/ossmalaysia/ezychat-lite.git\n';
      if (cmd === 'gh') return 'feat: x\n';
      return 'MERGE OK · risk:auto (96)\n';
    },
    ...over,
  });
  const ev = (e) => JSON.stringify({ cwd: '/x', transcript_path: '/t.jsonl', ...e });

  it('ignores other tools and bad input', () => {
    expect(main(ev({ tool_name: 'Read' }), deps())).toEqual({ code: 0 });
    expect(main('{oops', deps()).code).toBe(2);
    expect(main('', deps())).toEqual({ code: 0 });
  });
  it('allows via the script for this repository and names the script call', () => {
    expect(main(ev(merge(7)), deps())).toEqual({ code: 0 });
    expect(calls).toContain('node scripts/release-review.mjs 7');
  });
  it('denies with exit 2 and a reason', () => {
    const r = main(ev({ tool_name: 'mcp__github__enable_pr_auto_merge', tool_input: {} }), deps());
    expect(r).toMatchObject({ code: 2 });
    expect(r.message).toContain('merge-gate:');
    expect(
      main(ev({ tool_name: 'Bash', tool_input: { command: 'gh pr merge 1' } }), deps()).code,
    ).toBe(2);
  });
  it('fails closed when the origin or transcript cannot be read', () => {
    const noOrigin = deps({
      exec: (cwd, cmd) => {
        if (cmd === 'git') throw new Error('no remote');
        return 'MERGE OK · risk:auto (96)';
      },
    });
    expect(main(ev(merge(7)), noOrigin).code).toBe(2);
    const noTranscript = deps({
      readFile: () => {
        throw new Error('ENOENT');
      },
    });
    expect(main(ev(merge(7)), noTranscript).code).toBe(0); // script still says MERGE OK for this repo
    expect(main(ev(merge(7)), { ...noTranscript, exec: () => 'NOT READY' }).code).toBe(2);
  });
  it('treats a release PR (title from gh or commit_title) as needing the release word', () => {
    const rel = deps({
      exec: (cwd, cmd) =>
        cmd === 'git'
          ? 'git@github.com:ossmalaysia/ezychat-lite.git'
          : cmd === 'gh'
            ? 'chore(release): 0.1.86'
            : 'MERGE OK · risk:auto (99)',
    });
    expect(main(ev(merge(403)), rel).code).toBe(2);
    expect(main(ev(merge(403, { commit_title: 'chore(release): 0.1.86' })), deps()).code).toBe(2);
    const noGh = deps({
      exec: (cwd, cmd) => {
        if (cmd === 'gh') throw new Error('no gh');
        return cmd === 'git'
          ? 'https://github.com/ossmalaysia/ezychat-lite'
          : 'MERGE OK · risk:auto (99)';
      },
    });
    expect(main(ev(merge(5)), noGh).code).toBe(0);
  });
});
