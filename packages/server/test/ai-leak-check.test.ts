import { describe, expect, it } from 'vitest';
import { findLeak } from '../src/ai/leak-check.js';

// An Internal item (lowest price, margin note).
const internal = 'Our floor price for the Pro plan is RM 1,180 a seat; never go lower than that.';

describe('findLeak', () => {
  it('catches a reply that quotes 40 characters of an Internal item verbatim', () => {
    const run = internal.slice(10, 50);
    expect(run).toHaveLength(40);
    expect(findLeak(`Sure!#${run}#`, [internal])).toBe(true);
  });

  it('lets a 39-character run through', () => {
    const run = internal.slice(10, 49);
    expect(run).toHaveLength(39);
    expect(findLeak(`Sure!#${run}#`, [internal])).toBe(false);
  });

  it('still catches the run with changed spacing and case (Review Focus 3)', () => {
    const run = internal.slice(10, 50);
    const disguised = run.toUpperCase().replace(/ /g, '  \n ');
    expect(findLeak(`Here you go:\n${disguised}`, [internal])).toBe(true);
    // The internal text itself may hold odd spacing too.
    expect(findLeak(run, [internal.replace(/ /g, '\t  ')])).toBe(true);
  });

  it('checks every Internal item and allows replies that quote none', () => {
    expect(findLeak('We open 9am to 6pm.', [])).toBe(false);
    expect(findLeak('We open 9am to 6pm.', ['short', internal])).toBe(false);
    expect(findLeak(internal, ['other text that is long enough to check here', internal])).toBe(
      true,
    );
  });

  it('honours a custom minimum run', () => {
    expect(findLeak('plan is RM 1,180 a', [internal], 15)).toBe(true);
    expect(findLeak('plan is RM 1,180 a', [internal])).toBe(false);
  });
});
