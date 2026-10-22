import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PRESERVED_NOTE, changelogSection, releaseNotes } from './release-notes.mjs';

const CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '## [0.1.48] - 2026-10-23',
  '',
  '### Added',
  '',
  '- AI agents.',
  '',
  '## [0.1.47] - 2026-10-22',
  '',
  '### Fixed',
  '',
  '- Formatting.',
  '',
  '## [0.1.46] - 2026-10-21',
  '',
].join('\r\n');

it('takes one version section, with or without the v of the tag', () => {
  expect(changelogSection(CHANGELOG, 'v0.1.48')).toBe('### Added\n\n- AI agents.');
  expect(changelogSection(CHANGELOG, '0.1.47')).toBe('### Fixed\n\n- Formatting.');
});

it('has no notes for a missing or empty section', () => {
  expect(changelogSection(CHANGELOG, 'v0.1.49')).toBeNull();
  expect(changelogSection(CHANGELOG, 'v0.1.46')).toBeNull();
  // A prefix of another version never matches it.
  expect(changelogSection(CHANGELOG, 'v0.1.4')).toBeNull();
});

it('ends the release body with the data note and refuses a release without notes', () => {
  expect(releaseNotes(CHANGELOG, 'v0.1.48')).toBe(
    `### Added\n\n- AI agents.\n\n${PRESERVED_NOTE}\n`,
  );
  expect(() => releaseNotes(CHANGELOG, 'v0.1.46')).toThrow('CHANGELOG.md has no notes for v0.1.46');
});

it('reads the real changelog of a released version', () => {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  expect(releaseNotes(changelog, 'v0.1.47')).toContain('WhatsApp formatting');
});
