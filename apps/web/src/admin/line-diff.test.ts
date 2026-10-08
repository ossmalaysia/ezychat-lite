import { describe, expect, it } from 'vitest';
import { collapseDiff, lineDiff } from './line-diff';

describe('lineDiff', () => {
  it('marks identical text as unchanged lines', () => {
    expect(lineDiff('a\nb', 'a\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
    ]);
  });

  it('ignores a trailing empty line', () => {
    expect(lineDiff('a\nb\n', 'a\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
    ]);
  });

  it('lists pure additions', () => {
    expect(lineDiff('a', 'a\nb\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'add', text: 'c' },
    ]);
  });

  it('lists pure deletions', () => {
    expect(lineDiff('a\nb\nc', 'b')).toEqual([
      { type: 'del', text: 'a' },
      { type: 'same', text: 'b' },
      { type: 'del', text: 'c' },
    ]);
  });

  it('shows a changed line in the middle as a deletion before an addition', () => {
    expect(lineDiff('one\ntwo\nthree', 'one\nTWO\nthree')).toEqual([
      { type: 'same', text: 'one' },
      { type: 'del', text: 'two' },
      { type: 'add', text: 'TWO' },
      { type: 'same', text: 'three' },
    ]);
  });

  it('groups all deletions before additions in a changed block', () => {
    expect(lineDiff('x\na\nb\ny', 'x\nc\nd\ny')).toEqual([
      { type: 'same', text: 'x' },
      { type: 'del', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'c' },
      { type: 'add', text: 'd' },
      { type: 'same', text: 'y' },
    ]);
  });

  it('handles empty before and after', () => {
    expect(lineDiff('', 'a\nb')).toEqual([
      { type: 'add', text: 'a' },
      { type: 'add', text: 'b' },
    ]);
    expect(lineDiff('a', '')).toEqual([{ type: 'del', text: 'a' }]);
    expect(lineDiff('', '')).toEqual([]);
  });

  it('keeps blank lines inside the text', () => {
    expect(lineDiff('a\n\nb', 'a\n\nb\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: '' },
      { type: 'same', text: 'b' },
      { type: 'add', text: 'c' },
    ]);
  });
});

describe('collapseDiff', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

  it('keeps one unchanged line around each change and folds the rest', () => {
    const before = lines(10);
    const after = before.replace('line 5', 'line five');
    expect(collapseDiff(lineDiff(before, after))).toEqual([
      { type: 'skip', count: 3 },
      { type: 'same', text: 'line 4' },
      { type: 'del', text: 'line 5' },
      { type: 'add', text: 'line five' },
      { type: 'same', text: 'line 6' },
      { type: 'skip', count: 4 },
    ]);
  });

  it('never folds a single line (showing it is as short as the fold note)', () => {
    const before = lines(5);
    const after = before.replace('line 3', 'line three');
    expect(collapseDiff(lineDiff(before, after)).some((l) => l.type === 'skip')).toBe(false);
  });

  it('shows nearby changes in one block', () => {
    const before = lines(6);
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
