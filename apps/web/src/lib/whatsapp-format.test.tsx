import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatWhatsApp, plainWhatsApp } from './whatsapp-format';

/** The rendered HTML of one message body, as the bubble shows it. */
function html(text: string): string {
  const { container } = render(<p>{formatWhatsApp(text)}</p>);
  return container.firstElementChild!.innerHTML;
}

describe('formatWhatsApp', () => {
  it('shows *bold*, _italic_, ~strikethrough~ and `code` without the marks, as WhatsApp does', () => {
    expect(html('We are an *OpenAI Select Partner*.')).toBe(
      'We are an <strong>OpenAI Select Partner</strong>.',
    );
    expect(html('_soon_')).toBe('<em>soon</em>');
    expect(html('~RM 10~ RM 8')).toBe('<s>RM 10</s> RM 8');
    expect(html('Run `npm test` now')).toBe('Run <code>npm test</code> now');
  });

  it('nests marks: *_bold italic_*', () => {
    expect(html('*_both_*')).toBe('<strong><em>both</em></strong>');
  });

  it('shows ```monospace``` blocks as they are, with no formatting inside', () => {
    expect(html('Code:\n```a *b* c\nd```')).toBe('Code:\n<code data-block="">a *b* c\nd</code>');
  });

  it('keeps the marks as text when WhatsApp would: spaces inside, inside words, or across lines', () => {
    for (const text of [
      '2 * 3 * 4',
      'a * not bold *',
      'snake_case_name',
      'file_name_v2.pdf',
      '*first line\nsecond*',
      'a ** b',
      'price*2*3',
    ])
      expect(html(text)).toBe(text);
  });

  it('accepts punctuation around the marks: (*bold*), *bold*!', () => {
    expect(html('(*yes*)')).toBe('(<strong>yes</strong>)');
    expect(html('*yes*!')).toBe('<strong>yes</strong>!');
  });

  it('keeps links clickable and never formats inside them', () => {
    const out = html('See https://example.com/a_b_c and *this*');
    expect(out).toContain(
      '<a href="https://example.com/a_b_c" target="_blank" rel="noopener noreferrer nofollow"',
    );
    expect(out).toContain('>https://example.com/a_b_c</a>');
    expect(out).toContain('<strong>this</strong>');
  });

  it('shows quotes and bulleted lists as WhatsApp lines', () => {
    const out = html('> quoted *text*\n* one\n- two\n1. first');
    expect(out).toContain('<span data-quote="">quoted <strong>text</strong></span>');
    expect(out).toContain('<span data-bullet="">one</span>');
    expect(out).toContain('<span data-bullet="">two</span>');
    expect(out).toContain('1. first');
  });

  it('never turns message text into HTML', () => {
    expect(html('<b>hi</b> *<i>x</i>*')).toBe(
      '&lt;b&gt;hi&lt;/b&gt; <strong>&lt;i&gt;x&lt;/i&gt;</strong>',
    );
  });
});

describe('plainWhatsApp (previews)', () => {
  it('drops the marks that WhatsApp hides and keeps everything else', () => {
    expect(plainWhatsApp('We are an *OpenAI Select Partner*, _soon_ ~old~')).toBe(
      'We are an OpenAI Select Partner, soon old',
    );
    expect(plainWhatsApp('```code *x*```')).toBe('code *x*');
    expect(plainWhatsApp('2 * 3 * 4 and snake_case')).toBe('2 * 3 * 4 and snake_case');
    expect(plainWhatsApp('> quoted\n* item')).toBe('quoted\n• item');
  });
});
