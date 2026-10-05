import { AI_CONTEXT_CHARACTERS, codePointLength } from '@wa-team-inbox/shared';

export interface MigratedAiKnowledge {
  instructions: string;
  context: string;
  /** The old notes + FAQs exceeded the Business context limit; only the start was kept. */
  truncated: boolean;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * Stored AI member knowledge → the current shape. Before Business context existed, knowledge was
 * `notes` plus a list of FAQs; they become one context text (notes, then "Q: …\nA: …" per FAQ).
 * Pure and tolerant: malformed stored values are dropped rather than failing to load settings.
 */
export function migrateAiKnowledge(stored: unknown): MigratedAiKnowledge {
  const old = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const instructions = text(old.instructions);
  if (typeof old.context === 'string')
    return { instructions, context: old.context, truncated: false };
  let context = text(old.notes);
  for (const faq of Array.isArray(old.faqs) ? old.faqs : []) {
    const { question, answer } = (faq ?? {}) as Record<string, unknown>;
    if (typeof question !== 'string' || typeof answer !== 'string') continue;
    context += `\n\nQ: ${question.trim()}\nA: ${answer.trim()}`;
  }
  context = context.trim();
  const truncated = codePointLength(context) > AI_CONTEXT_CHARACTERS;
  return {
    instructions,
    context: truncated ? sliceCodePoints(context, AI_CONTEXT_CHARACTERS) : context,
    truncated,
  };
}

/** The first `count` Unicode code points; never ends inside a surrogate pair (emoji). */
export function sliceCodePoints(text: string, count: number): string {
  let end = 0;
  for (let taken = 0; taken < count && end < text.length; taken++)
    end += text.codePointAt(end)! > 0xffff ? 2 : 1;
  return text.slice(0, end);
}
