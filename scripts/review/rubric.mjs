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
 *   checkNames?: {missing: string[], pending: string[], failed: string[]},
 *   coverageState?: 'head'|'pending'|'unknown'|string (a short commit: same PR diff),
 *   reviewComments?: {total: number, open: number|null}|null,
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
  if (input.checks !== 'green') hardStops.push({ id: 4, reason: checksReason(input) });
  // Unresolved review threads block the merge (conversation resolution is required on main).
  const review = input.reviewComments ?? null;
  if (review?.open)
    hardStops.push({
      id: 5,
      reason: `${review.open} unresolved review ${review.open === 1 ? 'thread' : 'threads'}`,
    });
  else if (review && review.open === null && review.total)
    hardStops.push({ id: 5, reason: `${review.total} review comments, resolution unknown` });

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
      label: coverageLabel(input),
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
    ...(review ? [reviewItem(review)] : []),
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

/** Hard stop 4 names each required check that is not green. */
function checksReason({ checks, checkNames }) {
  const names = checkNames ?? { missing: [], pending: [], failed: [] };
  const parts = [];
  if (names.failed.length) parts.push(`failed: ${names.failed.join(', ')}`);
  if (names.pending.length) parts.push(`running: ${names.pending.join(', ')}`);
  if (names.missing.length) parts.push(`missing: ${names.missing.join(', ')}`);
  const head = checks === 'pending' ? 'checks pending' : 'checks failed';
  return parts.length ? `${head} (${parts.join('; ')})` : head;
}

/** Coverage is read from the head, or from an older commit with the same PR diff; pending while CI runs. */
function coverageLabel({ coverage, coverageState }) {
  if (coverage === null)
    return coverageState === 'pending'
      ? 'Changed-lines coverage pending (CI running)'
      : 'Changed-lines coverage unknown';
  const from =
    coverageState && !['head', 'pending', 'unknown'].includes(coverageState)
      ? ` (from \`${coverageState}\`, same PR diff)`
      : '';
  return `Changed-lines coverage ${coverage} %${from}`;
}

/** Hard stops the owner's logged approval of the PR's current diff clears: 1 real part, 2 migration, 3 security. */
const OWNER_STOPS = [1, 2, 3];

/**
 * The final merge verdict: `MERGE OK` only when no hard stop is left, the PR is ready for review,
 * has no merge conflict, and is risk:auto / risk:pipeline or the owner approved its current diff.
 * Pure: the same facts always give the same line.
 * @param pr {{state?: string, draft: boolean, conflict: boolean, approved: string|null}} approved = the approved short commit
 */
export function mergeVerdict(result, pr) {
  const reasons = [];
  if (pr.state && pr.state !== 'open') reasons.push(`PR is ${pr.state}`);
  if (pr.draft) reasons.push('PR is a draft');
  if (pr.conflict) reasons.push('merge conflict with main');
  for (const stop of result.hardStops)
    if (!(pr.approved && OWNER_STOPS.includes(stop.id))) reasons.push(stop.reason);
  if (!pr.approved && result.score < AUTO_AT && result.decision !== 'risk:pipeline')
    reasons.push(`score ${result.score} < ${AUTO_AT}: the owner tests and approves`);
  const approval = pr.approved ? `, owner approved \`${pr.approved}\`` : '';
  const tail = ` · ${result.decision} (${result.score})${approval}`;
  return {
    ok: reasons.length === 0,
    reasons,
    line: reasons.length ? `NOT READY: ${reasons.join('; ')}${tail}` : `MERGE OK${tail}`,
  };
}

/** Review comments: shown with their count, no points (open threads are hard stop 5). */
function reviewItem({ total, open }) {
  const label =
    open === null
      ? `Review comments: ${total} (resolution unknown)`
      : `Review comments: ${open} open of ${total}`;
  return { label, points: 0, applies: true, ok: open === null ? total === 0 : open === 0 };
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
