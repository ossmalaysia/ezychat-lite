import { describe, expect, it } from 'vitest';
import { scoreChange, sizePoints } from './rubric.mjs';

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
