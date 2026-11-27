/**
 * Finds "name@domain"-shaped addresses (emails, WhatsApp chat ids) in linear time.
 *
 * A plain `/[\w.+-]+@…/g` has no start anchor: on a long word without an `@` the engine retries from
 * every letter, so 20,000 letters took 0.2–0.4 s (DEBT L-28). A lookbehind start anchor would be fast
 * but not redaction-safe: after one match a second address glued to it ("a@b.com+c@d.com") would be
 * missed. This scanner starts from each separator instead and gives exactly the matches of the plain
 * pattern `[\w.+-]+<separator><tail>` with the global flag (pinned by `address-scan.test.ts`).
 */

/** The local part's letters: `[\w.+-]` (ASCII `\w`, as in the plain patterns). */
const isLocal = (code: number) =>
  (code >= 48 && code <= 57) || // 0-9
  (code >= 65 && code <= 90) || // A-Z
  (code >= 97 && code <= 122) || // a-z
  code === 95 || // _
  code === 46 || // .
  code === 43 || // +
  code === 45; // -

export interface AddressPattern {
  /** The separator, with the global flag (e.g. `/@/g`). Its text must not hold a local-part letter first. */
  separator: RegExp;
  /** What follows the separator, with the sticky flag (e.g. `/[\w-]+(?:\.[\w-]+)+/y`). */
  tail: RegExp;
}

/** Every `[start, end)` span the plain pattern would match, in order. */
export function addressSpans(text: string, pattern: AddressPattern): Array<[number, number]> {
  const { separator, tail } = pattern;
  const spans: Array<[number, number]> = [];
  let from = 0; // end of the last match: a new match never starts before it
  separator.lastIndex = 0;
  for (let sep = separator.exec(text); sep; sep = separator.exec(text)) {
    const at = sep.index;
    let start = at;
    while (start > from && isLocal(text.charCodeAt(start - 1))) start--;
    let next = at + 1;
    if (start < at) {
      tail.lastIndex = at + sep[0].length;
      const rest = tail.exec(text);
      if (rest) {
        const end = tail.lastIndex;
        spans.push([start, end]);
        from = end;
        next = Math.max(end, next);
      }
    }
    separator.lastIndex = next;
  }
  return spans;
}

/** The text with every match replaced by `replacement`. */
export function replaceAddresses(
  text: string,
  pattern: AddressPattern,
  replacement: string,
): string {
  const spans = addressSpans(text, pattern);
  if (spans.length === 0) return text;
  let out = '';
  let last = 0;
  for (const [start, end] of spans) {
    out += text.slice(last, start) + replacement;
    last = end;
  }
  return out + text.slice(last);
}

/** Every match as text. */
export const addressesIn = (text: string, pattern: AddressPattern): string[] =>
  addressSpans(text, pattern).map(([start, end]) => text.slice(start, end));

/** An email: the shape of `/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g`. */
export const EMAIL_ADDRESS: AddressPattern = { separator: /@/g, tail: /[\w-]+(?:\.[\w-]+)+/y };

/** A WhatsApp chat id, also URL-encoded: the shape of the log scrubber's `JID` pattern. */
export const WHATSAPP_ADDRESS: AddressPattern = {
  separator: /@|%40/gi,
  tail: /(?:s\.whatsapp\.net|lid|g\.us|c\.us|broadcast|newsletter)\b/iy,
};
