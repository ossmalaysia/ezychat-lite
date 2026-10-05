import type { AiDecision } from '@wa-team-inbox/shared';

/** Exact short confirmations (kept for callers and as one confirmation signal). */
export function isResolutionConfirmation(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase()
    .replace(/[.!?,。！？，]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(yes|yep|yeah|yes thanks|yes thank you|yes resolved|resolved|all sorted|that's all|that is all|that's all thanks|no more questions|ya|ya terima kasih|sudah|sudah selesai|selesai|betul|baik|是|是的|好了|已解决|解决了|谢谢|是的谢谢)$/.test(
    normalized,
  );
}

/**
 * Polite or closing phrases that contain a negation word but confirm ("no problem", "no thanks",
 * "no, that's all", "没有了", "tak ada lagi"). They are removed before looking for objections.
 */
const HARMLESS =
  /\b(?:no|nope)[\s,.!]*(?:thanks|thank you|that['’]s all|that is all)\b|no problem|no worries|no more questions|tiada masalah|takde masalah|tak apa|\b(?:tak ada|takde|tiada) lagi\b|没有了|没问题|没事了|不客气|不用了/gi;
const OBJECTION =
  /\b(no|nope|not|dont|doesnt|didnt|isnt|cant|wont|havent|wasnt|but|however|still|tidak|tak|bukan|belum|tapi|tetapi|namun)\b|n['’]t\b/i;
const OBJECTION_ZH = /不|没|但是|可是/;
const NEW_REQUEST =
  /\b(can you|could you|i want|i need|i would like|also|one more thing|wait|actually|need|want|how|what|when|where|which|boleh|nak|mahu|perlu|macam mana|bagaimana|bila|berapa)\b|我想|我要|怎么|什么|多少|哪/i;
const CONFIRMING =
  /\b(yes|yep|yeah|ok|okay|noted|thanks|thank you|resolved|sorted|done|great|perfect|all good|that['’]s all|that is all|ya|baik|terima kasih|selesai|sudah|dah|faham|okey|tak ada lagi|takde lagi|tiada lagi)\b|好|谢谢|明白|是的|可以了|解决|没有了|没事了/i;

/** The customer asks something, hesitates or objects — never close the chat on this message. */
export function objectsToResolution(text: string): boolean {
  const rest = text.replace(HARMLESS, ' ');
  return (
    /[?？]/.test(rest) || OBJECTION.test(rest) || OBJECTION_ZH.test(rest) || NEW_REQUEST.test(rest)
  );
}

/** A reply that reads as "yes, done"; any question, objection or new request wins (e.g. "谢谢？"). */
export function looksLikeConfirmation(text: string): boolean {
  return !objectsToResolution(text) && (isResolutionConfirmation(text) || CONFIRMING.test(text));
}

export const MAX_RESOLUTION_QUESTIONS = 2;
export const ASK_RESOLUTION_REPLY = 'Does that answer your question?';
export const RESOLVED_REPLY =
  'Thank you! I will close this chat now. Message us any time if you need more help.';

/**
 * Server-side gate on closing a chat; `asked` = resolution questions already sent in a row.
 * A model `resolve` is accepted after at least one question unless the customer objects. After
 * MAX_RESOLUTION_QUESTIONS questions, a confirming-looking reply resolves when the model would
 * only ask again, so customers are never asked forever. Answers and hand-offs are never changed.
 * `customerText` is every customer message since the last AI reply, so one objection in a batch
 * keeps the chat open.
 */
export function guardResolution(
  decision: AiDecision,
  asked: number,
  customerText: string,
): AiDecision {
  if (decision.action === 'handoff') return decision;
  if (decision.action === 'resolve')
    return asked > 0 && !objectsToResolution(customerText)
      ? decision
      : { action: 'ask_resolution', reply: ASK_RESOLUTION_REPLY };
  if (
    decision.action === 'ask_resolution' &&
    asked >= MAX_RESOLUTION_QUESTIONS &&
    looksLikeConfirmation(customerText)
  )
    return { action: 'resolve', reply: RESOLVED_REPLY };
  return decision;
}
