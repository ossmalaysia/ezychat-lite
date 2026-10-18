/** The longest Sales Agent name the server accepts (AiMemberBody.displayName). */
export const AGENT_NAME_MAX = 64;

/**
 * The Sales Agent name for a business, e.g. "Kedai Aisyah AI". A long business name is shortened at
 * a word boundary so the whole name, the " AI" part included, fits in AGENT_NAME_MAX characters.
 * `format` is the translated template (the business name may come first or last).
 */
export function agentNameFor(business: string, format: (business: string) => string): string {
  const name = business.trim().replace(/\s+/g, ' ');
  const full = format(name);
  if (full.length <= AGENT_NAME_MAX) return full;
  const budget = Math.max(1, AGENT_NAME_MAX - format('').length);
  let cut = name.slice(0, budget);
  // Prefer the last whole word, unless that drops most of the name (long words, CJK without spaces).
  const space = cut.lastIndexOf(' ');
  if (name[budget] !== ' ' && space >= budget / 2) cut = cut.slice(0, space);
  cut = cut.replace(/[\s,.;:&/(-]+$/u, '');
  return format(cut).slice(0, AGENT_NAME_MAX);
}
