// Release review: an Enterprise core bump takes the lowest Lite score of the Lite PRs it brings in
// (spec §4.3). Lite PRs merged before the release review started count as approved (owner, 2026-10-24).
import { parseIndex } from './log.mjs';

/** The pinned version of the first `prefix*` dependency in a package.json object, or null. */
export function corePin(pkg, prefix) {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const name = Object.keys(pkg?.[field] ?? {}).find((n) => n.startsWith(prefix));
    if (name) return pkg[field][name];
  }
  return null;
}

/** Lite PR numbers named `(#123)` in squash-merge commit messages, with their commit dates. */
export function prsFromCommits(commits) {
  const prs = [];
  for (const c of commits) {
    const m = c.commit.message.split('\n')[0].match(/\(#(\d+)\)\s*$/);
    if (m) prs.push({ number: Number(m[1]), mergedAt: c.commit.committer.date.slice(0, 10) });
  }
  return prs;
}

/** The Enterprise result capped by the Lite score; a Lite PR that needs a test is a hard stop. */
export function applyCoreBump(result, bump) {
  if (!bump) return result;
  const label = `Core ${bump.from} → ${bump.to}: lowest Lite score ${bump.score ?? '—'}`;
  const items = [...result.items, { label, points: 0, applies: true, ok: !bump.human }];
  const score = bump.score === null ? result.score : Math.min(result.score, bump.score);
  const hardStops = bump.human
    ? [...result.hardStops, { id: 5, reason: bump.reasons.join('; ') }]
    : result.hardStops;
  const safe = result.decision !== 'risk:human' && !hardStops.length && score >= 70;
  const decision = safe ? result.decision : 'risk:human';
  return { ...result, score, items, hardStops, decision };
}

/**
 * @param litePrs {{number:number, mergedAt:string}[]} @param liteIndexMarkdown {string}
 * @returns {{ score: number|null, human: boolean, reasons: string[] }}
 */
export function coreBumpScore(litePrs, liteIndexMarkdown) {
  const rows = parseIndex(liteIndexMarkdown ?? '');
  const start = rows.map((r) => r.date).sort()[0] ?? null;
  const reasons = [];
  let score = null;
  let human = false;
  for (const pr of litePrs) {
    if (!start || pr.mergedAt < start) continue; // before the release review: approved by the old rule
    const mine = rows.filter((r) => r.pr === pr.number);
    const last = mine.at(-1);
    if (!last) {
      human = true;
      reasons.push(`Lite #${pr.number} was not reviewed`);
      continue;
    }
    const scored = mine.filter((r) => Number.isFinite(r.score)).at(-1);
    if (scored) score = score === null ? scored.score : Math.min(score, scored.score);
    if (last.decision === 'risk:human') {
      human = true;
      reasons.push(`Lite #${pr.number} needs the owner's test (score ${scored?.score ?? '?'})`);
    }
  }
  return { score, human, reasons };
}
