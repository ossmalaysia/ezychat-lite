import { describe, expect, it } from 'vitest';
import { Lru } from './lru.js';

describe('Lru', () => {
  it('evicts least recently used beyond max', () => {
    const l = new Lru<string, number>(2);
    l.set('a', 1);
    l.set('b', 2);
    l.get('a');
    l.set('c', 3);
    expect(l.get('b')).toBeUndefined();
    expect(l.get('a')).toBe(1);
    expect(l.get('c')).toBe(3);
    expect(l.size).toBe(2);
  });
});
