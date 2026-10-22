/** Shortest verbatim run of an Internal item that counts as a leak. */
export const AI_LEAK_MIN_RUN = 40;

/** Collapse every whitespace run to one space and lower-case, so spacing and case tricks still match. */
const normalise = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * True when the reply holds a run of at least `minRun` characters copied from one of the Internal
 * items (after whitespace collapse and lower-casing on both sides). Such a reply is never sent.
 * Internal texts are capped at 10,000 characters per agent, so a rolling window is cheap enough.
 */
export function findLeak(
  reply: string,
  internalTexts: readonly string[],
  minRun = AI_LEAK_MIN_RUN,
): boolean {
  const haystack = normalise(reply);
  if (haystack.length < minRun) return false;
  for (const raw of internalTexts) {
    const text = normalise(raw);
    for (let start = 0; start + minRun <= text.length; start++)
      if (haystack.includes(text.slice(start, start + minRun))) return true;
  }
  return false;
}
