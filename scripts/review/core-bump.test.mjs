import { describe, expect, it } from 'vitest';
import { applyCoreBump, coreBumpScore, corePin, prsFromCommits } from './core-bump.mjs';

const index = (...rows) =>
  [
    '| Date | PR | Commit | Tier | Score | Decision | Log |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      ([date, pr, score, decision]) =>
        `| ${date} | #${pr} | \`abc1234\` | core | ${score} | ${decision} | x |`,
    ),
  ].join('\n');

describe('core bump', () => {
  it('reads the pinned core version and the Lite PRs', () => {
    expect(corePin({ dependencies: { '@ezychat/server': '0.1.49', zod: '4' } }, '@ezychat/')).toBe(
      '0.1.49',
    );
    expect(corePin({ dependencies: { zod: '4' } }, '@ezychat/')).toBeNull();
    const commits = [
      {
        commit: { message: 'feat: x (#163)\n\nbody', committer: { date: '2026-10-25T01:00:00Z' } },
      },
      { commit: { message: 'chore: no number', committer: { date: '2026-10-25T01:00:00Z' } } },
    ];
    expect(prsFromCommits(commits)).toEqual([{ number: 163, mergedAt: '2026-10-25' }]);
  });

  it('Lite PRs from before the release review count as approved', () => {
    const r = coreBumpScore(
      [{ number: 150, mergedAt: '2026-10-20' }],
      index(['2026-10-25', 163, 90, 'risk:auto']),
    );
    expect(r).toEqual({ score: null, human: false, reasons: [] });
  });

  it('an unreviewed new Lite PR forces a human test', () => {
    const r = coreBumpScore(
      [{ number: 170, mergedAt: '2026-10-26' }],
      index(['2026-10-25', 163, 90, 'risk:auto']),
    );
    expect(r.human).toBe(true);
    expect(r.reasons).toEqual(['Lite #170 was not reviewed']);
  });

  it('takes the lowest Lite score; an owner approval clears the human test', () => {
    const md = index(
      ['2026-10-25', 163, 90, 'risk:auto'],
      ['2026-10-25', 164, 40, 'risk:human'],
      ['2026-10-26', 164, '—', 'human-approved'],
    );
    const prs = [
      { number: 163, mergedAt: '2026-10-25' },
      { number: 164, mergedAt: '2026-10-26' },
    ];
    expect(coreBumpScore(prs, md)).toEqual({ score: 40, human: false, reasons: [] });
    expect(coreBumpScore(prs, md.split('\n').slice(0, -1).join('\n')).human).toBe(true);
  });

  it('caps the Enterprise result and adds a hard stop when a Lite PR needs a test', () => {
    const result = { score: 90, decision: 'risk:auto', items: [], hardStops: [] };
    expect(applyCoreBump(result, null)).toBe(result);
    const capped = applyCoreBump(result, {
      from: '0.1.49',
      to: '0.1.52',
      score: 60,
      human: false,
      reasons: [],
    });
    expect(capped).toMatchObject({ score: 60, decision: 'risk:human' });
    const ok = applyCoreBump(result, {
      from: '0.1.49',
      to: '0.1.52',
      score: 80,
      human: false,
      reasons: [],
    });
    expect(ok).toMatchObject({ score: 80, decision: 'risk:auto' });
    const stop = applyCoreBump(result, {
      from: 'a',
      to: 'b',
      score: null,
      human: true,
      reasons: ['Lite #170 was not reviewed'],
    });
    expect(stop.hardStops).toEqual([{ id: 5, reason: 'Lite #170 was not reviewed' }]);
    expect(stop.decision).toBe('risk:human');
  });
});
