/**
 * Turns the Markdown that models tend to write into WhatsApp formatting, so customers never see stray
 * symbols. WhatsApp: *bold*, _italic_, ~strike~, ```mono```; no headings, tables or link syntax.
 * Text inside `code` or ```code``` is left as it is.
 */
export function toWhatsAppText(text: string): string {
  // Split out code so its content is never changed.
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/);
  return parts
    .map((part, index) => (index % 2 === 1 ? part : convert(part)))
    .join('')
    .trim();
}

function convert(text: string): string {
  return (
    stripHeadings(
      text
        // **bold** / __bold__ (Markdown) -> *bold* (WhatsApp). One line only, never empty.
        .replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, '*$1*')
        .replace(/__(?=\S)([^_\n]+?)__/g, '_$1_')
        // ~~strike~~ -> ~strike~
        .replace(/~~(?=\S)([^~\n]+?)~~/g, '~$1~'),
    )
      // [text](https://link) -> text (https://link); a link whose text is the address stays one address.
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
        label.trim() === url ? url : `${label.trim()} (${url})`,
      )
  );
}

const LINE_BREAK = /([\n\r\u2028\u2029])/;
const isBlank = (char: string | undefined) => char === ' ' || char === '\t';

/**
 * # Heading -> Heading (WhatsApp has no headings): each line as `^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$`
 * with the `m` flag gives, in linear time. That regex retried the lazy text at every position against the
 * whole tail of the line: a 2,000-character line took about 3 s and blocked the server (L-30).
 */
function stripHeadings(text: string): string {
  // Odd parts are the line breaks themselves (the ones `^`/`$` see with `m`), kept as they are.
  return text
    .split(LINE_BREAK)
    .map((part, index) => (index % 2 === 1 ? part : headingText(part)))
    .join('');
}

function headingText(line: string): string {
  let i = 0;
  while (i < 3 && isBlank(line[i])) i++;
  const hashes = i;
  while (i < line.length && line[i] === '#') i++;
  const count = i - hashes;
  if (count < 1 || count > 6 || !isBlank(line[i])) return line;
  while (isBlank(line[i])) i++;
  // The text needs one character: on a line of only blanks the last blank is the text, as in the regex.
  const start = i < line.length ? i : i - 1;
  if (start <= hashes + count) return line;
  // The shortest text whose tail is blanks, then #s, then blanks.
  let tail = line.length;
  while (tail > 0 && isBlank(line[tail - 1])) tail--;
  while (tail > 0 && line[tail - 1] === '#') tail--;
  while (tail > 0 && isBlank(line[tail - 1])) tail--;
  return line.slice(start, Math.max(start + 1, tail));
}
