import { describe, expect, it } from 'vitest';
import { validateEdition, validateExtensions } from './extensions.js';

describe('validateExtensions', () => {
  it('accepts an empty list and well-formed unique names', () => {
    expect(() => validateExtensions([])).not.toThrow();
    expect(() => validateExtensions([{ name: 'sso' }, { name: 'multi-number' }])).not.toThrow();
  });
  it.each(['', 'A', '1abc', 'has space', 'x'.repeat(33), 'lite', 'core'])(
    'rejects name %j',
    (name) => {
      expect(() => validateExtensions([{ name }])).toThrow(/extension name/);
    },
  );
  it('rejects duplicate names', () => {
    expect(() => validateExtensions([{ name: 'sso' }, { name: 'sso' }])).toThrow(
      /duplicate extension "sso"/,
    );
  });
});

describe('validateEdition', () => {
  it('accepts lite and enterprise, rejects malformed ids', () => {
    expect(() => validateEdition('lite')).not.toThrow();
    expect(() => validateEdition('enterprise')).not.toThrow();
    expect(() => validateEdition('Enterprise!')).toThrow(/edition/);
  });
});
