// No tracked file may keep merge conflict markers. A rename conflict writes 8-character markers
// ("<<<<<<<< HEAD:old/path"), which a search for 7 characters plus a space misses; mock folders
// are not type-checked or formatted by CI, so this test is their only guard.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const TEXT = /\.(?:[cm]?[jt]sx?|json|md|css|html|ya?ml|sql|txt|ps1|sh|svg)$/i;
const MARKER = /^(?:<{7,8}|>{7,8})(?: |$)/m;

describe('merge conflict markers', () => {
  it('appear in no tracked text file', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter((file) => TEXT.test(file));
    const broken = files.filter((file) => {
      try {
        return MARKER.test(readFileSync(file, 'utf8'));
      } catch {
        return false; // listed but deleted in the working tree
      }
    });
    expect(broken).toEqual([]);
  });
});
