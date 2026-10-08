import { describe, expect, it } from 'vitest';
import { collapseDiff, DIFF_MAX_LINE_PAIRS, lineDiff, type DiffLine } from './line-diff';

/** `' a'` unchanged, `'-a'` removed, `'+a'` added. */
const lines = (...spec: string[]): DiffLine[] =>
  spec.map((s) => ({
    type: s[0] === '-' ? 'del' : s[0] === '+' ? 'add' : 'same',
    text: s.slice(1),
  }));

describe('lineDiff', () => {
  it.each([
    ['identical text', 'a\nb', 'a\nb', lines(' a', ' b')],
    ['a trailing empty line is ignored', 'a\nb\n', 'a\nb', lines(' a', ' b')],
    ['pure additions', 'a', 'a\nb\nc', lines(' a', '+b', '+c')],
    ['pure deletions', 'a\nb\nc', 'b', lines('-a', ' b', '-c')],
    [
      'a changed line: old, then new',
      'one\ntwo\nthree',
      'one\nTWO\nthree',
      lines(' one', '-two', '+TWO', ' three'),
    ],
    [
      'a changed block: all removals first',
      'x\na\nb\ny',
      'x\nc\nd\ny',
      lines(' x', '-a', '-b', '+c', '+d', ' y'),
    ],
    ['empty before', '', 'a\nb', lines('+a', '+b')],
    ['empty after', 'a', '', lines('-a')],
    ['both empty', '', '', []],
    ['blank lines inside the text', 'a\n\nb', 'a\n\nb\nc', lines(' a', ' ', ' b', '+c')],
  ])('%s', (_name, before, after, expected) => {
    expect(lineDiff(before, after)).toEqual(expected);
  });

  it('stays fast and small for line-dense text (thousands of blank lines)', () => {
    // The worst valid input: an 8,000-character box that is almost all line breaks, changed at
    // both ends so no shared start or end can be skipped.
    const blank = '\n'.repeat(7997);
    const started = performance.now();
    const diff = lineDiff(`x${blank}y`, `X${blank}Y`);
    expect(performance.now() - started).toBeLessThan(500);
    // Too many line pairs to compare one by one: shown as the old block, then the new block.
    expect(diff[0]).toEqual({ type: 'del', text: 'x' });
    expect(diff.at(-1)).toEqual({ type: 'add', text: 'Y' });
    expect(diff.findIndex((l) => l.type === 'add')).toBe(7998);
  });

  it('compares a large changed middle as a removed block, then an added block (bounded memory)', () => {
    // Every other line changes, so a full line-by-line comparison would interleave unchanged
    // lines; past the size limit the middle is shown as one block out, one block in instead.
    const n = DIFF_MAX_LINE_PAIRS / 1000 + 1;
    expect(n).toBeGreaterThan(100);
    const before = Array.from({ length: n }, (_, i) => `line ${i}`);
    const after = before.map((line, i) => (i % 2 ? `${line} changed` : line));
    const diff = lineDiff(
      ['keep', ...before, 'end'].join('\n'),
      ['keep', ...after, 'x', 'end'].join('\n'),
    );
    expect(diff[0]).toEqual({ type: 'same', text: 'keep' });
    expect(diff.at(-1)).toEqual({ type: 'same', text: 'end' });
    // The shared first lines stay unchanged; from the first change on: one block out, one in.
    const types = diff.map((l) => l.type);
    const changed = types.slice(types.indexOf('del'), types.lastIndexOf('add') + 1);
    expect(changed).not.toContain('same');
    expect(changed.indexOf('add')).toBeGreaterThan(changed.lastIndexOf('del'));
  });

  it('still aligns unchanged lines when the change is small enough', () => {
    expect(lineDiff('a\nb\nc\nd', 'a\nB\nc\nD')).toEqual(lines(' a', '-b', '+B', ' c', '-d', '+D'));
  });
});

describe('collapseDiff', () => {
  const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

  it('keeps one unchanged line around each change and folds the rest', () => {
    const before = numbered(10);
    const after = before.replace('line 5', 'line five');
    expect(collapseDiff(lineDiff(before, after))).toEqual([
      { type: 'skip', count: 3 },
      ...lines(' line 4', '-line 5', '+line five', ' line 6'),
      { type: 'skip', count: 4 },
    ]);
  });

  it('never folds a single line (showing it is as short as the fold note)', () => {
    const before = numbered(5);
    const after = before.replace('line 3', 'line three');
    expect(collapseDiff(lineDiff(before, after)).some((l) => l.type === 'skip')).toBe(false);
  });

  it('shows nearby changes in one block', () => {
    const before = numbered(6);
    const after = before.replace('line 2', 'two').replace('line 4', 'four');
    expect(collapseDiff(lineDiff(before, after)).map((l) => l.type)).toEqual([
      'same',
      'del',
      'add',
      'same',
      'del',
      'add',
      'same',
      'same',
    ]);
  });
});
