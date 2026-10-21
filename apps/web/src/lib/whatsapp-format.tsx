import type React from 'react';

/**
 * WhatsApp message formatting, shown the way the WhatsApp app shows it: the marks are hidden and the
 * text is formatted. `*bold*`, `_italic_`, `~strikethrough~`, `` `inline code` ``, ```` ```monospace``` ````
 * (no formatting inside), `> quote`, `* item` / `- item` (bullets); `1. item` stays as typed.
 * A mark counts only when it touches the words (`*bold*`, never `* bold *`), does not sit inside a
 * word (`snake_case`), and does not cross a line. Links stay clickable and are never formatted.
 *
 * Output is React elements only (never HTML) and carries no classes: the message bubble styles
 * `strong`, `em`, `s`, `code`, `[data-block]`, `[data-quote]` and `[data-bullet]`.
 */

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
const BLOCK_CODE_RE = /```([\s\S]+?)```/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const QUOTE_RE = /^> (.*)$/;
const BULLET_RE = /^[*-] (.+)$/;

type Mark = '*' | '_' | '~';
const TAG: Record<Mark, 'strong' | 'em' | 's'> = { '*': 'strong', _: 'em', '~': 's' };

/** `<prefix>M<content>M`, with a non-word character (or the text edge) on both outer sides. */
const MARK_RE: Record<Mark, RegExp> = {
  '*': markRe('\\*'),
  _: markRe('_'),
  '~': markRe('~'),
};

function markRe(m: string): RegExp {
  return new RegExp(
    `(^|[^\\p{L}\\p{N}${m}])${m}(?=\\S)([^\\n]*?\\S)${m}(?=$|[^\\p{L}\\p{N}${m}])`,
    'u',
  );
}

/** The earliest mark in `text`: where it starts (after the prefix), its end, the tag and the inner text. */
function firstMark(text: string) {
  let best: { start: number; end: number; mark: Mark; inner: string } | null = null;
  for (const mark of Object.keys(MARK_RE) as Mark[]) {
    const m = MARK_RE[mark].exec(text);
    if (!m) continue;
    const start = m.index + m[1]!.length;
    if (!best || start < best.start)
      best = { start, end: m.index + m[0].length, mark, inner: m[2]! };
  }
  return best;
}

/** Splits `text` by a global regex with one capture group into [plain, captured, plain, …]. */
function split(text: string, re: RegExp): string[] {
  return text.split(new RegExp(re.source, re.flags.includes('u') ? 'gu' : 'g'));
}

class Keys {
  private n = 0;
  next(): string {
    return String(this.n++);
  }
}

function emphasis(text: string, keys: Keys): React.ReactNode[] {
  const found = firstMark(text);
  if (!found) return text ? [text] : [];
  const Tag = TAG[found.mark];
  return [
    ...(found.start ? [text.slice(0, found.start)] : []),
    <Tag key={keys.next()}>{inline(found.inner, keys)}</Tag>,
    ...emphasis(text.slice(found.end), keys),
  ];
}

/** One line (or the inside of a mark): inline code, links, then the emphasis marks. */
function inline(text: string, keys: Keys): React.ReactNode[] {
  return split(text, INLINE_CODE_RE).flatMap<React.ReactNode>((part, i) => {
    if (i % 2 === 1) return [<code key={keys.next()}>{part}</code>];
    return split(part, URL_RE).flatMap<React.ReactNode>((piece, j) =>
      j % 2 === 1
        ? [
            <a key={keys.next()} href={piece} target="_blank" rel="noopener noreferrer nofollow">
              {piece}
            </a>,
          ]
        : emphasis(piece, keys),
    );
  });
}

/** Quote and bullet lines are blocks; a newline is kept only between two ordinary lines. */
function lines(text: string, keys: Keys): React.ReactNode[] {
  const all = text.split('\n');
  const isBlock = (line: string) => QUOTE_RE.test(line) || BULLET_RE.test(line);
  return all.flatMap<React.ReactNode>((line, i) => {
    const quote = QUOTE_RE.exec(line);
    const bullet = quote ? null : BULLET_RE.exec(line);
    const node = quote ? (
      <span key={keys.next()} data-quote="">
        {inline(quote[1]!, keys)}
      </span>
    ) : bullet ? (
      <span key={keys.next()} data-bullet="">
        {inline(bullet[1]!, keys)}
      </span>
    ) : null;
    if (node) return [node];
    const out = inline(line, keys);
    const next = all[i + 1];
    return next !== undefined && !isBlock(next) ? [...out, '\n'] : out;
  });
}

/** A message body as WhatsApp shows it (React nodes for a `whitespace-pre-wrap` element). */
export function formatWhatsApp(text: string): React.ReactNode[] {
  const keys = new Keys();
  return split(text, BLOCK_CODE_RE).flatMap<React.ReactNode>((part, i) =>
    i % 2 === 1
      ? [
          <code key={keys.next()} data-block="">
            {part}
          </code>,
        ]
      : lines(part, keys),
  );
}

/** The same text without the marks WhatsApp hides, for one-line previews (quotes, chat list). */
export function plainWhatsApp(text: string): string {
  return split(text, BLOCK_CODE_RE)
    .map((part, i) => (i % 2 === 1 ? part : plainLines(part)))
    .join('');
}

function plainLines(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const quote = QUOTE_RE.exec(line);
      if (quote) return plainInline(quote[1]!);
      const bullet = BULLET_RE.exec(line);
      if (bullet) return `• ${plainInline(bullet[1]!)}`;
      return plainInline(line);
    })
    .join('\n');
}

function plainInline(text: string): string {
  return split(text, INLINE_CODE_RE)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : split(part, URL_RE)
            .map((piece, j) => (j % 2 === 1 ? piece : plainMarks(piece)))
            .join(''),
    )
    .join('');
}

function plainMarks(text: string): string {
  const found = firstMark(text);
  if (!found) return text;
  return text.slice(0, found.start) + plainMarks(found.inner) + plainMarks(text.slice(found.end));
}
