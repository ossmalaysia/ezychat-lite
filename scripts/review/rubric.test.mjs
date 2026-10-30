import { describe, expect, it } from 'vitest';
import { mergeVerdict, scoreChange, sizePoints } from './rubric.mjs';

const ALL = { e2e: true, linkCheck: true, screenReview: true, devBuild: true, realTest: false };
const file = (path, tier, lines, extra = {}) => ({
  path,
  tier,
  added: lines,
  deleted: 0,
  lockfile: false,
  security: false,
  realTest: null,
  ...extra,
});
const input = (over) => ({
  files: [],
  dependencyTier: null,
  screenChanged: true,
  migrations: [],
  migrationConfirmed: null,
  agentsSecurityChanged: false,
  checks: 'green',
  coverage: 100,
  evidence: ALL,
  ...over,
});

describe('spec examples', () => {
  it('#158 small non-core fix → 95 auto', () => {
    const r = scoreChange(input({ files: [file('apps/web/src/admin/x.tsx', 'noncore', 36)] }));
    expect(r).toMatchObject({ score: 95, decision: 'risk:auto', tier: 'noncore' });
  });
  it('#162 non-core, 301–1,000 lines → 75 auto', () => {
    const r = scoreChange(input({ files: [file('apps/web/src/admin/x.tsx', 'noncore', 600)] }));
    expect(r).toMatchObject({ score: 75, decision: 'risk:auto' });
  });
  it('#159 critical, > 1,000 lines, no real test → 35 human with hard stop 1', () => {
    const r = scoreChange(
      input({
        files: [
          file('packages/wa/src/baileys/adapter.ts', 'critical', 1200, {
            realTest: 'real WhatsApp',
          }),
        ],
      }),
    );
    expect(r).toMatchObject({ score: 35, decision: 'risk:human', tier: 'critical' });
    expect(r.hardStops).toEqual([
      { id: 1, reason: 'critical change without a real WhatsApp test' },
    ]);
  });
});

describe('rubric', () => {
  it('docs only → 100 auto; pipeline + docs → pipeline', () => {
    expect(scoreChange(input({ files: [file('docs/a.md', 'docs', 500)] }))).toMatchObject({
      score: 100,
      decision: 'risk:auto',
    });
    expect(
      scoreChange(
        input({
          files: [file('docs/a.md', 'docs', 5), file('.github/workflows/ci.yml', 'pipeline', 40)],
        }),
      ),
    ).toMatchObject({ decision: 'risk:pipeline' });
  });
  it('a server-only change gets full screen points', () => {
    const r = scoreChange(
      input({
        files: [file('packages/server/src/ai/x.ts', 'core', 100)],
        screenChanged: false,
        evidence: { ...ALL, linkCheck: false, screenReview: false },
      }),
    );
    expect(r.score).toBe(50 - 15 - 10 + 20 + 10 + 5 + 10 + 5);
  });
  it('coverage under 90 % adds nothing; unknown coverage adds nothing', () => {
    const files = [file('packages/server/src/ai/x.ts', 'core', 10)];
    expect(scoreChange(input({ files, coverage: 89 })).items[2]).toMatchObject({
      points: 0,
      ok: false,
    });
    expect(scoreChange(input({ files, coverage: 92 })).items[2].points).toBe(15);
    expect(scoreChange(input({ files, coverage: null })).items[2].points).toBe(0);
  });
  it('pending or failed checks are a hard stop', () => {
    const files = [file('docs/a.md', 'docs', 1)];
    expect(scoreChange(input({ files, checks: 'pending' }))).toMatchObject({
      decision: 'risk:human',
      hardStops: [{ id: 4, reason: 'checks pending' }],
    });
    expect(scoreChange(input({ files, checks: 'failed' })).hardStops[0].reason).toBe(
      'checks failed',
    );
  });
  it('migrations: unconfirmed and moves-data stop, adds-only does not', () => {
    const files = [file('packages/server/src/db/migrations/9.sql', 'critical', 5)];
    const ev = { ...ALL, realTest: true };
    const ids = (confirmed) =>
      scoreChange(
        input({ files, evidence: ev, migrations: [files[0].path], migrationConfirmed: confirmed }),
      ).hardStops.map((h) => h.reason);
    expect(ids(null)).toEqual(['migration not confirmed as adds-only']);
    expect(ids('moves-data')).toEqual(['migration moves existing data']);
    expect(ids('adds-only')).toEqual([]);
  });
  it('a security file or the AGENTS.md security section is hard stop 3', () => {
    const sec = scoreChange(
      input({
        files: [file('packages/server/src/http/origin.ts', 'critical', 5, { security: true })],
        evidence: { ...ALL, realTest: true },
      }),
    );
    expect(sec.hardStops).toEqual([
      { id: 3, reason: 'security rule: packages/server/src/http/origin.ts' },
    ]);
    const agents = scoreChange(
      input({
        files: [file('apps/web/src/admin/x.tsx', 'noncore', 5)],
        agentsSecurityChanged: true,
      }),
    );
    expect(agents.hardStops[0]).toMatchObject({ id: 3 });
    expect(agents.decision).toBe('risk:human');
  });
  it('a critical dependency makes the change critical; lockfiles count no lines', () => {
    const r = scoreChange(
      input({
        files: [
          file('package.json', 'noncore', 2),
          file('package-lock.json', 'noncore', 900, { lockfile: true }),
        ],
        dependencyTier: 'critical',
      }),
    );
    expect(r.tier).toBe('critical');
    expect(r.countedLines).toBe(2);
    expect(r.tierFiles).toContain('package.json dependencies');
  });
  it('clamps to 0–100 and sizes by counted lines', () => {
    const r = scoreChange(
      input({
        files: [file('packages/wa/x.ts', 'critical', 5000)],
        coverage: 0,
        evidence: {
          e2e: false,
          linkCheck: false,
          screenReview: false,
          devBuild: false,
          realTest: false,
        },
      }),
    );
    expect(r.score).toBe(0);
    expect([50, 51, 300, 301, 1000, 1001].map(sizePoints)).toEqual([0, -10, -10, -20, -20, -35]);
  });
});

describe('review comments', () => {
  const code = [file('apps/web/src/admin/x.tsx', 'noncore', 36)];
  const item = (r) => r.items.find((i) => i.label.startsWith('Review comments'));

  it('an unresolved thread is hard stop 5 and shows as missing, without changing the points', () => {
    const open = scoreChange(input({ files: code, reviewComments: { total: 4, open: 2 } }));
    const none = scoreChange(input({ files: code }));
    expect(open.score).toBe(none.score);
    expect(open.decision).toBe('risk:human');
    expect(open.hardStops).toContainEqual({ id: 5, reason: '2 unresolved review threads' });
    expect(item(open)).toMatchObject({
      label: 'Review comments: 2 open of 4',
      points: 0,
      ok: false,
    });
    expect(item(none)).toBeUndefined();
  });

  it('all threads resolved keeps the decision; unknown resolution shows the count only', () => {
    const done = scoreChange(input({ files: code, reviewComments: { total: 4, open: 0 } }));
    expect(done).toMatchObject({ decision: 'risk:auto', hardStops: [] });
    expect(item(done)).toMatchObject({ label: 'Review comments: 0 open of 4', ok: true });
    const unknown = scoreChange(input({ files: code, reviewComments: { total: 1, open: null } }));
    // Unknown resolution cannot pass a final merge check.
    expect(unknown.hardStops).toEqual([{ id: 5, reason: '1 review comments, resolution unknown' }]);
    expect(item(unknown)).toMatchObject({
      label: 'Review comments: 1 (resolution unknown)',
      ok: false,
    });
    const quiet = scoreChange(input({ files: code, reviewComments: { total: 0, open: null } }));
    expect(item(quiet).ok).toBe(true);
  });

  it('stops a docs-only PR with an unresolved thread too', () => {
    const r = scoreChange(
      input({ files: [file('docs/x.md', 'docs', 5)], reviewComments: { total: 1, open: 1 } }),
    );
    expect(r).toMatchObject({ score: 100, decision: 'risk:human' });
    expect(r.hardStops).toContainEqual({ id: 5, reason: '1 unresolved review thread' });
  });
});

describe('checks and coverage labels', () => {
  const code = [file('packages/server/src/x.ts', 'core', 10)];
  const label = (r) => r.items.find((i) => i.label.startsWith('Changed-lines')).label;
  it('hard stop 4 names each required check that is not green', () => {
    const r = scoreChange(
      input({
        files: code,
        checks: 'failed',
        checkNames: { missing: ['C'], pending: ['B'], failed: ['A'] },
      }),
    );
    expect(r.hardStops).toContainEqual({
      id: 4,
      reason: 'checks failed (failed: A; running: B; missing: C)',
    });
  });
  it('coverage shows pending while CI runs, and names the commit it came from', () => {
    expect(
      label(scoreChange(input({ files: code, coverage: null, coverageState: 'pending' }))),
    ).toBe('Changed-lines coverage pending (CI running)');
    expect(label(scoreChange(input({ files: code, coverage: null })))).toBe(
      'Changed-lines coverage unknown',
    );
    expect(label(scoreChange(input({ files: code, coverage: 96, coverageState: 'abc1234' })))).toBe(
      'Changed-lines coverage 96 % (from `abc1234`, same PR diff)',
    );
    expect(label(scoreChange(input({ files: code, coverage: 96, coverageState: 'head' })))).toBe(
      'Changed-lines coverage 96 %',
    );
  });
});

describe('merge verdict', () => {
  const pr = (over = {}) => ({ draft: false, conflict: false, approved: null, ...over });
  const auto = scoreChange(input({ files: [file('apps/web/src/admin/x.tsx', 'noncore', 36)] }));
  const critical = scoreChange(
    input({
      files: [file('packages/wa/src/baileys/x.ts', 'critical', 400, { realTest: 'real WhatsApp' })],
    }),
  );

  it('MERGE OK for a risk:auto PR with nothing left', () => {
    expect(mergeVerdict(auto, pr())).toEqual({
      ok: true,
      reasons: [],
      line: 'MERGE OK · risk:auto (95)',
    });
  });
  it('NOT READY lists draft, conflict, hard stops and a low score', () => {
    const v = mergeVerdict(critical, pr({ draft: true, conflict: true }));
    expect(v.ok).toBe(false);
    expect(v.reasons).toEqual([
      'PR is a draft',
      'merge conflict with main',
      'critical change without a real WhatsApp test',
      `score ${critical.score} < 70: the owner tests and approves`,
    ]);
    expect(v.line).toMatch(/^NOT READY: PR is a draft; merge conflict with main; /);
  });
  it("the owner's approval clears the owner-test stops, never checks or open threads", () => {
    expect(mergeVerdict(critical, pr({ approved: 'abc1234' }))).toMatchObject({
      ok: true,
      line: `MERGE OK · risk:human (${critical.score}), owner approved \`abc1234\``,
    });
    const red = scoreChange(
      input({
        files: [file('packages/wa/src/baileys/x.ts', 'critical', 40)],
        checks: 'pending',
        reviewComments: { total: 1, open: 1 },
      }),
    );
    expect(mergeVerdict(red, pr({ approved: 'abc1234' })).reasons).toEqual([
      'checks pending',
      '1 unresolved review thread',
    ]);
  });
  it('a merged or closed PR is never MERGE OK', () => {
    expect(mergeVerdict(auto, pr({ state: 'merged' })).reasons).toEqual(['PR is merged']);
    expect(mergeVerdict(auto, pr({ state: 'open' })).ok).toBe(true);
  });
  it('a pipeline-only PR needs no score', () => {
    const pipeline = scoreChange(
      input({ files: [file('.github/workflows/x.yml', 'pipeline', 5)] }),
    );
    expect(mergeVerdict(pipeline, pr()).ok).toBe(true);
  });
});
