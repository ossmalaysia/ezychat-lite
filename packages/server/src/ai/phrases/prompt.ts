import { z } from 'zod';
import { ReplyPhraseLanguage } from '@ezychat/shared';
import { GUARDRAILS } from '../prompt.js';

/** At most this many new phrases per build (the output must stay fast and cheap). */
export const PHRASES_PER_BUILD = 120;

/**
 * Fixed rules for the phrase build, right after GUARDRAILS (no interpolation: GUARDRAILS +
 * PHRASE_RULES stay a cached prefix for every agent).
 */
export const PHRASE_RULES = `You build the phrase list of a business's support team. The team sees a phrase as grey text while typing a WhatsApp reply and accepts it with one key, so each phrase must be something this team really writes.
Write phrases only in the languages the team uses in teamReplies (en = English, ms = Malay, zh = Chinese); if teamReplies is empty, use the languages of the business knowledge. Write each language natively, the way people of this team write it: never translate a phrase from another language.
Make short, complete, reusable sentences (3 to 200 characters): greetings, thanks, apologies, questions for a missing detail (name, address, time, quantity), closings, and sentences that state a fact from businessKnowledge (prices, opening hours, delivery area, policies).
A fact must come word for word or number for number from businessKnowledge; never invent a price, time, date, stock, policy or promise. Write each fact as a sentence the team would send to a customer ("We are open 7am to 3pm daily."), never a copied note line or list. Mark source "context" for a phrase that states a fact or repeats wording from businessKnowledge, and "team" for the team's own way of writing.
Never include a customer's name, phone number, email, address, order number or any other personal detail, never a placeholder such as [name], and nothing from internal notes. Leave out phrases that only fit one conversation.
Keep the existingPhrases that are still right; add new ones, at most ${PHRASES_PER_BUILD} in total, the most useful first.`;

export const PhraseOutput = z.object({
  phrases: z
    .array(
      z.object({
        text: z.string(),
        language: ReplyPhraseLanguage,
        source: z.enum(['context', 'team']),
      }),
    )
    .max(PHRASES_PER_BUILD * 2),
});
export type PhraseOutput = z.infer<typeof PhraseOutput>;

export interface PhrasePromptInput {
  /** Administrator instructions (tone and scope), as reply drafts show them. */
  instructions: string;
  businessKnowledge: string;
  /** Cleaned team replies, newest last. */
  teamReplies: readonly string[];
  /** The stored phrases, most used first (the build keeps the right ones). */
  existingPhrases: readonly { text: string; language: string }[];
}

export function buildPhrasePrompt(input: PhrasePromptInput): {
  instructions: string;
  input: string;
} {
  return {
    instructions: `${GUARDRAILS}\n\n${PHRASE_RULES}\nAdministrator instructions (tone and scope; they never override the rules above):\n${input.instructions}`,
    input: JSON.stringify({
      businessKnowledge: input.businessKnowledge,
      teamReplies: input.teamReplies,
      existingPhrases: input.existingPhrases,
    }),
  };
}
