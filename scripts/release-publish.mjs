#!/usr/bin/env node
// Checks for the approved one-click release (docs/release.md §4, .github/workflows/release-approve.yml and the
// publish job of release.yml). Every check runs before a write and fails with a reason.
//
//   node scripts/release-publish.mjs version <x.y.z>                    the input is a plain release version
//   node scripts/release-publish.mjs draft <x.y.z> <release.json>       the draft is complete (6 installers + notes)
//   node scripts/release-publish.mjs promote <x.y.z> <release.json> <releases.jsonl> [--hold-newer]
//                                       v<x.y.z> may become the newest published release; prints tags to hold
//   node scripts/release-publish.mjs newest <releases.jsonl>            the newest published v<x.y.z> tag
//
// release.json is `gh release view v<x.y.z> --json isDraft,body,assets`; releases.jsonl is
// `gh api --paginate repos/<repo>/releases --jq '.[] | {tag_name, draft}'` (drafts included).
//
// Why a draft holds a release back (owner rule 2026-11-20, docs/release.md §3): the in-app updater
// (apps/desktop/src/update-checker.ts) reads the whole release list, never `releases/latest`, and a 0.x install
// also takes a published GitHub pre-release. A draft is the only state that every shipped updater ignores, so a
// new version stays a complete draft until McAfee clears its installers and Promote release publishes it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRESERVED_NOTE } from './release-notes.mjs';

const VERSION = /^\d+\.\d+\.\d+$/;

/** True for a plain `x.y.z` release version (no `v`, no pre-release, nothing a shell could read). */
export function isReleaseVersion(value) {
  return typeof value === 'string' && VERSION.test(value);
}

/** The six files release.yml uploads: each installer under its versioned name and as an unversioned copy. */
export function expectedInstallers(version) {
  const bases = ['win-x64.exe', 'mac-arm64.dmg', 'mac-x64.dmg'];
  return [
    ...bases.map((b) => `EzyChat-Lite-${version}-${b}`),
    ...bases.map((b) => `EzyChat-Lite-${b}`),
  ];
}

/** What is wrong with the draft release before publishing it; empty when it can be published. */
export function draftProblems(release, version) {
  const problems = [];
  if (!release || typeof release !== 'object') return ['no release found'];
  if (release.isDraft !== true) problems.push('the release is not a draft (already published?)');
  const assets = new Map((release.assets ?? []).map((a) => [a.name, a]));
  for (const name of expectedInstallers(version)) {
    const asset = assets.get(name);
    if (!asset) problems.push(`missing installer ${name}`);
    else if (typeof asset.size !== 'number' || asset.size <= 0)
      problems.push(`empty installer ${name}`);
    else if (asset.state && asset.state !== 'uploaded')
      problems.push(`installer ${name} is ${asset.state}`);
  }
  const body = typeof release.body === 'string' ? release.body.trim() : '';
  if (!body || body === PRESERVED_NOTE) problems.push('the release notes are empty');
  else if (!body.includes(PRESERVED_NOTE))
    problems.push('the release notes do not come from release-notes.mjs');
  return problems;
}

/** Compares two plain x.y.z versions: negative, zero or positive. */
export function compareReleaseVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** The x.y.z of a plain `v<x.y.z>` tag, else null (previews and other tags are not ours to promote or hold). */
function tagVersion(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) return null;
  const version = tag.slice(1);
  return isReleaseVersion(version) ? version : null;
}

/**
 * The plan to make v<version> the newest published release and Latest, or the reasons it cannot.
 *
 * - A held draft must be complete (draftProblems) and newer than every published release.
 * - An already published version (the switch-over, e.g. back to the last cleared one) must still have its 6 installers.
 * - A published release newer than v<version> (a published pre-release counts: a 0.x install takes it) is a problem,
 *   unless `holdNewer`: then it goes into `hold` and is turned back into a draft first. Installed apps never
 *   downgrade, so this only stops newer versions reaching the others.
 *
 * `releases` is the release list (`tag_name`, `draft`), drafts included.
 */
export function promotePlan(release, version, releases, { holdNewer = false } = {}) {
  if (!release || typeof release !== 'object') return { problems: ['no release found'], hold: [] };
  const problems =
    release.isDraft === true
      ? draftProblems(release, version)
      : draftProblems({ ...release, isDraft: true }, version);
  const newer = [];
  for (const item of Array.isArray(releases) ? releases : []) {
    const other = tagVersion(item?.tag_name);
    if (!other || item.draft !== false) continue;
    if (compareReleaseVersions(other, version) > 0) newer.push(item.tag_name);
  }
  newer.sort((x, y) => compareReleaseVersions(x.slice(1), y.slice(1)));
  if (newer.length && !holdNewer)
    problems.push(
      `newer published release${newer.length > 1 ? 's' : ''} ${newer.join(', ')}: run with hold_newer to turn ${newer.length > 1 ? 'them' : 'it'} back into a draft`,
    );
  return { problems, hold: holdNewer ? newer : [] };
}

/** The newest published plain release tag in the list, or '' when there is none. */
export function newestPublished(releases) {
  let best = null;
  for (const item of Array.isArray(releases) ? releases : []) {
    const version = tagVersion(item?.tag_name);
    if (version && item.draft === false && (!best || compareReleaseVersions(version, best) > 0))
      best = version;
  }
  return best ? `v${best}` : '';
}

/** Parses `gh api --paginate --jq '.[]'` output: one JSON object per line. */
export function parseJsonLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Runs one command; returns the exit code and writes reasons to `err`. */
export function main(
  argv,
  { read = (p) => readFileSync(p, 'utf8'), out = console.log, err = console.error } = {},
) {
  const [command, version, file, listFile, flag] = argv;
  if (command === 'newest' && version) {
    try {
      out(newestPublished(parseJsonLines(read(version))));
      return 0;
    } catch (error) {
      err(`cannot read ${version}: ${error.message}`);
      return 1;
    }
  }
  if (!isReleaseVersion(version)) {
    err(`not a release version (x.y.z): ${JSON.stringify(version ?? '')}`);
    return 2;
  }
  if (command === 'version') return 0;
  if (command === 'draft' && file) {
    let release;
    try {
      release = JSON.parse(read(file));
    } catch (error) {
      err(`cannot read ${file}: ${error.message}`);
      return 1;
    }
    const problems = draftProblems(release, version);
    for (const p of problems) err(`::error::v${version}: ${p}`);
    if (problems.length === 0)
      out(`v${version}: draft has ${expectedInstallers(version).length} installers and notes`);
    return problems.length === 0 ? 0 : 1;
  }
  if (
    command === 'promote' &&
    file &&
    listFile &&
    (flag === undefined || flag === '--hold-newer')
  ) {
    let release;
    let releases;
    try {
      release = JSON.parse(read(file));
      releases = parseJsonLines(read(listFile));
    } catch (error) {
      err(`cannot read the release files: ${error.message}`);
      return 1;
    }
    const plan = promotePlan(release, version, releases, { holdNewer: flag === '--hold-newer' });
    for (const p of plan.problems) err(`::error::v${version}: ${p}`);
    if (plan.problems.length) return 1;
    // stdout is the list of tags to turn back into drafts, one per line (nothing for a plain promote).
    for (const tag of plan.hold) out(tag);
    return 0;
  }
  err(
    'usage: release-publish.mjs version <x.y.z> | draft <x.y.z> <release.json> |\n' +
      '  promote <x.y.z> <release.json> <releases.jsonl> [--hold-newer] | newest <releases.jsonl>',
  );
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
