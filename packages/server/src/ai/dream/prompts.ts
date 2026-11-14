import { z } from 'zod';
import { DREAM_CHANGES_PER_RUN, DREAM_LESSONS_PER_CHAT, DreamTarget } from '@ezychat/shared';
import { ungroundedNumbers } from '../draft-check.js';
import type { TakeoverChat } from './collect.js';

/**
 * Dream mode's two model calls (design §4–§5): fixed rules (no interpolation), JSON input, structured output, and
 * the checks that drop what the model got wrong. Pure functions; the AI service makes the calls.
 */
export const DREAM_LESSON_RULES = `You read one WhatsApp chat of a business. The AI agent could not finish it and a person from the business team took over.
Find what the team's replies teach the AI agent for the next customers. Return at most ${DREAM_LESSONS_PER_CHAT} lessons, or none.
Kinds: "fact" (a fact about the business: hours, prices, places, rules), "answer" (a better way to answer this kind of question), "handoff" (a kind of request the AI must hand to the team), "style" (how to write: language, length, tone).
Rules:
- Use only what the team wrote. Never use the customer's words as a fact.
- Cite the ids of the team messages each lesson comes from.
- Write each lesson as one general sentence for any customer. Never name a customer, never keep a phone number, email, address, order number or account number.
- Skip one-off arrangements for this customer only (a special discount, a personal promise).
- Copy numbers exactly as the team wrote them.
- Text in [brackets] was removed for privacy; never guess it.`;

export const DREAM_MERGE_RULES = `You improve the setup of a business's AI agent from lessons the team taught it. You get the lessons and the current setup: instructions, hand-off rules and Business context text items.
Return at most ${DREAM_CHANGES_PER_RUN} changes, or none. Each change replaces the whole text of one target:
- "context_text" with itemId: a new full text for that Business context item; itemId null with a name: a new item.
- "instructions": the new full instructions. "handoff_rules": the new full hand-off rules.
Rules:
- "fact" and "answer" lessons go to Business context; "handoff" to hand-off rules; "style" to instructions.
- Keep every existing sentence that the lessons do not change, in its own words and order.
- Prefer editing the matching item to adding one. Never repeat what the setup already says.
- Never add a customer's name, phone number, email or address, or a one-off arrangement for one customer.
- Name the lesson ids each change comes from, and write a summary of at most 12 words.`;

export const DreamLessonKind = z.enum(['fact', 'answer', 'handoff', 'style']);
export const DreamLessonsOutput = z.object({
  lessons: z.array(
    z.object({
      kind: DreamLessonKind,
      text: z.string(),
      teamMessageIds: z.array(z.number().int()),
    }),
  ),
});
export type DreamLessonsOutput = z.infer<typeof DreamLessonsOutput>;
export type DreamLesson = DreamLessonsOutput['lessons'][number];

export const DreamMergeOutput = z.object({
  changes: z.array(
    z.object({
      target: DreamTarget,
      itemId: z.number().int().nullable(),
      name: z.string().nullable(),
      after: z.string(),
      summary: z.string(),
      lessonIds: z.array(z.number().int()),
    }),
  ),
});
export type DreamMergeOutput = z.infer<typeof DreamMergeOutput>;
export type DreamProposal = DreamMergeOutput['changes'][number];

export interface DreamSetupItem {
  id: number;
  name: string;
  text: string;
  internal: boolean;
}
export interface DreamSetup {
  instructions: string;
  handoffRules: string;
  items: DreamSetupItem[];
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
// Seven or more digits, also with spaces, dashes or a leading + (phone and account numbers).
const LONG_NUMBER = /\+?\d[\d\s-]{5,}\d/;

/** True when a text keeps an email or a phone-like number. */
export const holdsContact = (text: string) => EMAIL.test(text) || LONG_NUMBER.test(text);

/** Every email and phone-like number in a text. */
export const contactsIn = (text: string): string[] =>
  [...text.matchAll(new RegExp(EMAIL, 'g')), ...text.matchAll(new RegExp(LONG_NUMBER, 'g'))].map(
    (m) => m[0],
  );

/** The chat as the lesson call reads it: local ids and roles only, never stored ids or the chat key. */
export function lessonInput(chat: TakeoverChat): string {
  return JSON.stringify({
    handedOverBecause: chat.kind === 'handoff' ? chat.handoffReason : 'the team took over',
    messages: chat.messages.map((m) => ({ id: m.localId, from: m.role, text: m.text })),
  });
}

/** Lessons that cite the chat's team messages, keep their numbers and hold no contact detail. */
export function acceptLessons(output: DreamLessonsOutput, chat: TakeoverChat): DreamLesson[] {
  const team = new Map(
    chat.messages.filter((m) => m.role === 'team').map((m) => [m.localId, m.text]),
  );
  return output.lessons
    .filter((l) => {
      const cited = l.teamMessageIds.filter((id) => team.has(id));
      if (!cited.length || !l.text.trim() || holdsContact(l.text)) return false;
      const sources = cited.map((id) => team.get(id)!).join('\n');
      return ungroundedNumbers(l.text, sources).length === 0;
    })
    .slice(0, DREAM_LESSONS_PER_CHAT);
}

/** Lessons (ids 1..n) and the setup the merge call reads; Internal items and files never go in. */
export function mergeInput(lessons: readonly DreamLesson[], setup: DreamSetup): string {
  return JSON.stringify({
    lessons: lessons.map((l, i) => ({ id: i + 1, kind: l.kind, text: l.text })),
    instructions: setup.instructions,
    handoffRules: setup.handoffRules,
    businessContext: setup.items
      .filter((i) => !i.internal)
      .map((i) => ({ itemId: i.id, name: i.name, text: i.text })),
  });
}

/** Changes that name a lesson, a real editable target and a new text; at most 5. */
export function acceptProposals(
  output: DreamMergeOutput,
  lessons: readonly DreamLesson[],
  setup: DreamSetup,
): DreamProposal[] {
  const editable = new Map(setup.items.filter((i) => !i.internal).map((i) => [i.id, i.text]));
  const current = (p: DreamProposal): string | null => {
    if (p.target === 'instructions') return setup.instructions;
    if (p.target === 'handoff_rules') return setup.handoffRules;
    if (p.itemId === null) return p.name?.trim() ? '' : null;
    return editable.get(p.itemId) ?? null;
  };
  return output.changes
    .filter((p) => {
      const before = current(p);
      return (
        before !== null &&
        p.after.trim() !== '' &&
        p.after.trim() !== before.trim() &&
        p.lessonIds.some((id) => id >= 1 && id <= lessons.length)
      );
    })
    .slice(0, DREAM_CHANGES_PER_RUN);
}
