// Release review: which tier a changed file belongs to (docs/release-review/components.json).
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

export const TIERS = ['critical', 'core', 'noncore', 'docs', 'pipeline'];
const CODE = /\.(?:[cm]?[jt]sx?|css|html|ya?ml|json|cts|mts|sql|sh|ps1)$/;
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

const matches = (path, glob) => posix.matchesGlob(path, glob);

/** Reads and checks the map; an unknown tier is an error, so a typo never weakens a rule. */
export function loadMap(path) {
  return parseMap(JSON.parse(readFileSync(path, 'utf8')));
}

export function parseMap(map) {
  for (const rule of map.components)
    if (!TIERS.includes(rule.tier)) throw new Error(`Unknown tier "${rule.tier}" for ${rule.glob}`);
  return {
    screenGlobs: [],
    neutralGlobs: [],
    criticalDependencies: [],
    ...map,
  };
}

/** The first matching rule; an unmatched code file counts as core (and is reported). */
export function classifyFile(map, path) {
  const rule = map.components.find((r) => matches(path, r.glob));
  if (rule)
    return {
      tier: rule.tier,
      name: rule.name,
      security: rule.security === true,
      realTest: rule.realTest ?? null,
      unmapped: false,
    };
  const code = CODE.test(path);
  return {
    tier: code ? 'core' : 'docs',
    name: code ? 'Unmapped code' : 'Unmapped file',
    security: false,
    realTest: null,
    unmapped: code,
  };
}

export const isScreenFile = (map, path) =>
  !/\.test\./.test(path) && map.screenGlobs.some((glob) => matches(path, glob));

export const isNeutral = (map, path) => map.neutralGlobs.some((glob) => matches(path, glob));

export const isLockfile = (path) => /(?:^|\/)package-lock\.json$/.test(path);

/** 'critical' / 'core' when a package.json changes a dependency version, null when it does not. */
export function dependencyTier(map, oldPkg, newPkg) {
  let tier = null;
  for (const field of DEPENDENCY_FIELDS) {
    const before = oldPkg?.[field] ?? {};
    const after = newPkg?.[field] ?? {};
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[name] === after[name]) continue;
      if (map.criticalDependencies.includes(name)) return 'critical';
      tier = 'core';
    }
  }
  return tier;
}
