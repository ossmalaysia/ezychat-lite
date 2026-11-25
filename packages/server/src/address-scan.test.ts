import { describe, expect, it } from 'vitest';
import {
  EMAIL_ADDRESS,
  WHATSAPP_ADDRESS,
  addressesIn,
  addressSpans,
  replaceAddresses,
  type AddressPattern,
} from './address-scan.js';

// The plain patterns the scanner replaces; they define the expected answers.
const PLAIN_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PLAIN_JID = /[\w.+-]+(?:@|%40)(?:s\.whatsapp\.net|lid|g\.us|c\.us|broadcast|newsletter)\b/gi;

/** A small, seeded random generator so a failure can be replayed. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomText(next: () => number, alphabet: string[], length: number) {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(next() * alphabet.length)];
  return out;
}

function compare(pattern: AddressPattern, plain: RegExp, alphabet: string[], seed: number) {
  const next = random(seed);
  for (let i = 0; i < 3000; i++) {
    const text = randomText(next, alphabet, 1 + Math.floor(next() * 40));
    expect(addressesIn(text, pattern), text).toEqual(text.match(plain) ?? []);
    expect(replaceAddresses(text, pattern, '[x]'), text).toBe(text.replace(plain, '[x]'));
  }
}

describe('address scan', () => {
  it('finds exactly what the plain email pattern finds', () => {
    compare(EMAIL_ADDRESS, PLAIN_EMAIL, ['a', 'B', '1', '_', '.', '+', '-', '@', ' ', '%', 'é'], 1);
  });

  it('finds exactly what the plain chat id pattern finds', () => {
    compare(
      WHATSAPP_ADDRESS,
      PLAIN_JID,
      [
        'a',
        '1',
        '.',
        '+',
        '-',
        '@',
        ' ',
        '%40',
        '%4',
        'lid',
        'LID',
        'g.us',
        'c.us',
        's.whatsapp.net',
        'x',
      ],
      2,
    );
  });

  it('redacts addresses glued to an earlier one', () => {
    // A lookbehind start anchor would leave the second address: it starts right after the first.
    expect(replaceAddresses('a@b.com+c@d.com', EMAIL_ADDRESS, '[email]')).toBe('[email][email]');
    expect(replaceAddresses('601@lid+602@lid', WHATSAPP_ADDRESS, '[chat]')).toBe('[chat][chat]');
    expect(addressSpans('mail me: ann.lee+shop@mail.example.com.', EMAIL_ADDRESS)).toEqual([
      [9, 38],
    ]);
  });

  it('leaves text without an address as it is', () => {
    expect(replaceAddresses('no address here @ all', EMAIL_ADDRESS, '[email]')).toBe(
      'no address here @ all',
    );
    expect(addressesIn('', EMAIL_ADDRESS)).toEqual([]);
  });

  it('scans a long word without an address in linear time', () => {
    // The plain pattern needs seconds here (quadratic); the scanner a few milliseconds.
    const long = 'a'.repeat(200_000);
    const tricky = `${'a'.repeat(100_000)}@${'b'.repeat(100_000)}`;
    const glued = 'a@b'.repeat(70_000);
    const started = performance.now();
    expect(replaceAddresses(long, EMAIL_ADDRESS, '[email]')).toBe(long);
    expect(replaceAddresses(long, WHATSAPP_ADDRESS, '[chat]')).toBe(long);
    expect(addressesIn(tricky, EMAIL_ADDRESS)).toEqual([]);
    expect(addressesIn(glued, EMAIL_ADDRESS)).toEqual([]);
    expect(addressesIn('%40'.repeat(70_000) + 'lid', WHATSAPP_ADDRESS)).toEqual(['40%40lid']);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
