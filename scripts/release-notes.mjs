#!/usr/bin/env node
// Writes the GitHub release body for one version from its CHANGELOG.md section. The desktop updater
// shows that body as the release notes, so a release without it shows an empty update dialog.
//
//   node scripts/release-notes.mjs v0.1.48 > release-notes.md
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PRESERVED_NOTE =
  'Your chats, teammates, WhatsApp link and AI settings stay as they are after the update.';

/** The body of `## [version]` in a Keep a Changelog file (headings kept), or null when it is missing or empty. */
export function changelogSection(changelog, version) {
  const wanted = version.replace(/^v/, '');
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${wanted}]`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## ['));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  return body || null;
}

/** The release body: the version's changelog section and the fixed data note. */
export function releaseNotes(changelog, version) {
  const section = changelogSection(changelog, version);
  if (section === null) throw new Error(`CHANGELOG.md has no notes for ${version}`);
  return `${section}\n\n${PRESERVED_NOTE}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node scripts/release-notes.mjs <version>');
    process.exit(2);
  }
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  try {
    process.stdout.write(releaseNotes(changelog, version));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
