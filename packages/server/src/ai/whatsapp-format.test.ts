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
});
