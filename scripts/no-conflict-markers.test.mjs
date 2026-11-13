// No tracked file may keep merge conflict markers. A rename conflict writes 8-character markers
// ("<<<<<<<< HEAD:old/path"), which a search for 7 characters plus a space misses; mock folders
// are not type-checked or formatted by CI, so this test is their only guard.
// `git grep` searches the tracked files in one native process: reading ~3,500 files from the test
// itself took over the 5 s test limit on a busy macOS runner.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEXT = [
  'cjs',
  'mjs',
  'js',
  'jsx',
  'cts',
  'mts',
  'ts',
  'tsx',
  'json',
  'md',
  'css',
  'html',
  'yml',
  'yaml',
  'sql',
  'txt',
  'ps1',
  'sh',
  'svg',
];
const MARKER = '^(<{7,8}|>{7,8})( |$)';

/** Tracked text files (by extension, any case) with a conflict marker line, under `cwd`. */
export function filesWithMarkers(cwd = process.cwd()) {
  const pathspecs = TEXT.map((ext) => `:(glob,icase)**/*.${ext}`);
  const result = spawnSync('git', ['grep', '-l', '-I', '-E', MARKER, '--', ...pathspecs], {
    cwd,
    encoding: 'utf8',
  });
  // git grep: 0 = found, 1 = nothing found, anything else = it could not search
  if (result.status === 1) return [];
  if (result.status !== 0) throw new Error(`git grep failed: ${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean);
}

describe('merge conflict markers', () => {
  it('appear in no tracked text file', () => {
    expect(filesWithMarkers()).toEqual([]);
  });

  it('finds 7- and 8-character markers in tracked text files only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'markers-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      git('init', '-q');
      mkdirSync(join(dir, 'docs', 'mock'), { recursive: true });
      writeFileSync(join(dir, 'a.ts'), 'const a = 1;\n<<<<<<< HEAD\n');
      writeFileSync(join(dir, 'docs', 'mock', 'B.HTML'), '<p>\n>>>>>>>> theirs:old/path\n');
      writeFileSync(join(dir, 'clean.md'), 'a line with <<<<<<< inside\n=======\n');
      writeFileSync(join(dir, 'image.png'), '<<<<<<< HEAD\n');
      writeFileSync(join(dir, 'untracked.ts'), '<<<<<<< HEAD\n');
      git('add', 'a.ts', 'docs/mock/B.HTML', 'clean.md', 'image.png');
      expect(filesWithMarkers(dir).sort()).toEqual(['a.ts', 'docs/mock/B.HTML']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
