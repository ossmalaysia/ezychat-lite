import { describe, expect, it } from 'vitest';
import { toWhatsAppText } from './whatsapp-format.js';

describe('toWhatsAppText', () => {
  it('turns Markdown bold into WhatsApp bold (the stray-asterisk bug)', () => {
    expect(toWhatsAppText('the **ASUS Ascent GX10 1TB**, built on GB10')).toBe(
      'the *ASUS Ascent GX10 1TB*, built on GB10',
    );
    expect(toWhatsAppText('__Note__: open daily')).toBe('_Note_: open daily');
    expect(toWhatsAppText('~~RM40,000~~ RM38,000')).toBe('~RM40,000~ RM38,000');
  });

  it('keeps WhatsApp formatting and plain text as they are', () => {
    const text = '*Kaya jam* is _in stock_ at RM14.50 ~old price~. 2 * 3 = 6';
    expect(toWhatsAppText(text)).toBe(text);
  });

  it('removes Markdown headings', () => {
    expect(toWhatsAppText('## Delivery\nWe deliver daily.')).toBe('Delivery\nWe deliver daily.');
    expect(toWhatsAppText('# Prices #')).toBe('Prices');
  });

  it('writes links as text with the address', () => {
    expect(toWhatsAppText('See [our menu](https://example.com/menu).')).toBe(
      'See our menu (https://example.com/menu).',
    );
    expect(toWhatsAppText('[https://example.com](https://example.com)')).toBe(
      'https://example.com',
    );
  });

  it('never changes code', () => {
    expect(toWhatsAppText('Use `**not bold**` here')).toBe('Use `**not bold**` here');
    expect(toWhatsAppText('```\n# not a heading\n```')).toBe('```\n# not a heading\n```');
  });

  it('does not touch a bold marker that spans lines or is empty', () => {
    expect(toWhatsAppText('**\nsplit\n**')).toBe('**\nsplit\n**');
    expect(toWhatsAppText('a **** b')).toBe('a **** b');
  });

  it('removes headings exactly as the old pattern did, in linear time (L-30)', () => {
    // The old pattern, kept only to compare: it retried the lazy text against the whole tail of a line.
    const OLD = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
    const old = (text: string) => text.replace(OLD, '$1');
    const heading = (text: string) => toWhatsAppText(`x\n${text}\nx`).slice(2, -2);
    expect(heading('#  ')).toBe(old('#  '));
    expect(heading('#  ')).toBe(' ');
    expect(heading('# ')).toBe('# ');
    expect(heading('## ##')).toBe('#');
    expect(heading('####### seven')).toBe('####### seven');
    expect(heading('    # four blanks')).toBe('    # four blanks');
    expect(heading('#\tTabbed\t#\t')).toBe('Tabbed');
    expect(heading('# a\r# b\u2028# c')).toBe('a\rb\u2028c');
    // Seeded fuzz over the characters the pattern cares about.
    let seed = 42;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const alphabet = [' ', '\t', '#', 'a', '\n', '\r', '\u2028'];
    for (let run = 0; run < 5000; run++) {
      let text = '';
      for (let length = random(14); length > 0; length--) text += alphabet[random(alphabet.length)];
      expect(heading(text), JSON.stringify(text)).toBe(old(text));
    }
    // A reply line of 20,000 blanks between a heading and a word took minutes with the old pattern.
    const long = `# a${' '.repeat(20_000)}b #`;
    const started = performance.now();
    expect(toWhatsAppText(long)).toBe(`a${' '.repeat(20_000)}b`);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
