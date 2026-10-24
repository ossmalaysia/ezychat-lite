// Release review: the safety score (docs/superpowers/specs/2026-10-24-release-review-design.md §3).
// Pure: the same input always gives the same score. Agents never change these points.

export const START = 50;
export const AUTO_AT = 70;
export const TIER_POINTS = { critical: -30, core: -15, noncore: -5, docs: 0, pipeline: 0 };
const RANK = ['docs', 'pipeline', 'noncore', 'core', 'critical'];
const CODE_TIERS = ['critical', 'core', 'noncore'];

export function sizePoints(lines) {
  if (lines <= 50) return 0;
  if (lines <= 300) return -10;
  if (lines <= 1000) return -20;
  return -35;
}

const highest = (tiers) =>
  tiers.reduce((top, tier) => (RANK.indexOf(tier) > RANK.indexOf(top) ? tier : top), 'docs');

/**
 * @param input {{ files: {path,tier,security,realTest,added,deleted,lockfile}[], dependencyTier: string|null,
 *   screenChanged: boolean, migrations: string[], migrationConfirmed: 'adds-only'|'moves-data'|null,
 *   agentsSecurityChanged: boolean, checks: 'green'|'pending'|'failed', coverage: number|null,
 *   evidence: {e2e,linkCheck,screenReview,devBuild,realTest: boolean} }}
 */
export function scoreChange(input) {
  const { files, evidence } = input;
  const tier = highest([...files.map((f) => f.tier), input.dependencyTier ?? 'docs']);
  const tierFiles = files.filter((f) => f.tier === tier).map((f) => f.path);
  if (input.dependencyTier === tier && tier !== 'docs') tierFiles.push('package.json dependencies');
  const countedLines = files
    .filter((f) => CODE_TIERS.includes(f.tier) && !f.lockfile)
    .reduce((sum, f) => sum + f.added + f.deleted, 0);

  const hardStops = [];
  if (input.checks !== 'green')
    hardStops.push({
      id: 4,
      reason: input.checks === 'pending' ? 'checks pending' : 'checks failed',
    });

  // Only docs/tests (and pipeline) files: no code risk to score.
  if (tier === 'docs' || tier === 'pipeline') {
    const decision = hardStops.length
      ? 'risk:human'
      : tier === 'docs'
        ? 'risk:auto'
        : 'risk:pipeline';
    return { score: 100, decision, tier, tierFiles, countedLines, items: [], hardStops };
  }

  const critical = tier === 'critical';
  const coverage = input.coverage ?? 0;
  const items = [
    { label: `Tier: ${tier}`, points: TIER_POINTS[tier], applies: true, ok: true },
    {
      label: `Size: ${countedLines} code lines`,
      points: sizePoints(countedLines),
      applies: true,
      ok: true,
    },
    {
      label: `Changed-lines coverage ${input.coverage === null ? 'unknown' : `${coverage} %`}`,
      points: coverage >= 95 ? 20 : coverage >= 90 ? 15 : 0,
      applies: true,
      ok: coverage >= 90,
    },
    {
      label: 'e2e covers the change',
      points: evidence.e2e ? 10 : 0,
      applies: true,
      ok: evidence.e2e,
    },
    evidenceItem('Desktop link check', 5, input.screenChanged, evidence.linkCheck),
    {
      label: 'Dev Build check',
      points: evidence.devBuild ? 10 : 0,
      applies: true,
      ok: evidence.devBuild,
    },
    evidenceItem('Screen review', 5, input.screenChanged, evidence.screenReview),
    evidenceItem('Real-part test', 15, critical, evidence.realTest, 0),
  ];

  if (critical && !evidence.realTest) {
    const parts = [...new Set(files.filter((f) => f.realTest).map((f) => f.realTest))];
    hardStops.push({
      id: 1,
      reason: `critical change without a ${parts.join(' / ') || 'real-part'} test`,
    });
  }
  if (input.migrations.length && input.migrationConfirmed !== 'adds-only')
    hardStops.push({
      id: 2,
      reason:
        input.migrationConfirmed === 'moves-data'
          ? 'migration moves existing data'
          : 'migration not confirmed as adds-only',
    });
  const security = files.filter((f) => f.security).map((f) => f.path);
  if (input.agentsSecurityChanged) security.push('AGENTS.md security invariants');
  if (security.length) hardStops.push({ id: 3, reason: `security rule: ${security.join(', ')}` });

  const raw = START + items.reduce((sum, item) => sum + item.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  const decision = score >= AUTO_AT && !hardStops.length ? 'risk:auto' : 'risk:human';
  return { score, decision, tier, tierFiles, countedLines, items, hardStops };
}

/**
 * An evidence item that does not apply: screen items keep their full points (spec §3.3); the
 * real-part test is critical-only, so it adds nothing elsewhere (spec example #158 = 95).
 */
function evidenceItem(label, points, applies, ok, notNeeded = points) {
  if (!applies)
    return { label: `${label} (not needed)`, points: notNeeded, applies: false, ok: true };
  return { label, points: ok ? points : 0, applies: true, ok };
}
