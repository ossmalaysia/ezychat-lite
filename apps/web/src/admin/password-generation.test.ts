import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { canGeneratePassword, generatePassword } from './adminUi';

afterEach(() => vi.unstubAllGlobals());

it('generates readable passwords with secure browser randomness, including LAN HTTP without randomUUID', () => {
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  expect(canGeneratePassword()).toBe(true);
  const passwords = Array.from({ length: 10 }, () => generatePassword());
  expect(
    passwords.every((password) =>
      /^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]{14}$/.test(password),
    ),
  ).toBe(true);
  expect(new Set(passwords).size).toBe(10);
});

it.each([undefined, {}])(
  'never falls back to weak randomness when crypto is unavailable (%s)',
  (crypto) => {
    vi.stubGlobal('crypto', crypto);
    const weakRandom = vi.spyOn(Math, 'random');
    expect(canGeneratePassword()).toBe(false);
    expect(generatePassword()).toBe('');
    expect(weakRandom).not.toHaveBeenCalled();
    weakRandom.mockRestore();
  },
);
