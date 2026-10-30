import { z } from 'zod';

/**
 * Ask Ezy (design: docs/features/ask-ezy/design.md): an assistant panel for every signed-in user. It answers
 * questions about chats and customers with the MCP read tools on the business's AI connection, and (admins
 * only) proposes changes to an AI agent that apply only after Apply. Answers are text plus typed blocks: the
 * model never sends HTML.
 */

export const ASK_EZY_QUESTION_CHARACTERS = 2000;
/** Earlier turns sent back with a question (the conversation lives only in the open panel). */
export const ASK_EZY_HISTORY_TURNS = 12;
export const ASK_EZY_ANSWER_CHARACTERS = 4000;
const text = (max: number) => z.string().trim().min(1).max(max);
const short = text(200);

export const AskEzyTurn = z.object({
  role: z.enum(['user', 'assistant']),
  text: text(ASK_EZY_ANSWER_CHARACTERS),
});
export type AskEzyTurn = z.infer<typeof AskEzyTurn>;

/** `POST /api/ask-ezy` body. `chatJid` scopes the question to one chat (the conversation header button). */
export const AskEzyRequest = z.strictObject({
  question: text(ASK_EZY_QUESTION_CHARACTERS),
  history: z.array(AskEzyTurn).max(ASK_EZY_HISTORY_TURNS).default([]),
  chatJid: z.string().min(1).max(200).nullable().default(null),
});
export type AskEzyRequest = z.infer<typeof AskEzyRequest>;

export const AskEzyTest = z.object({
  question: text(1000),
  before: text(2000),
  after: text(2000),
});
export type AskEzyTest = z.infer<typeof AskEzyTest>;

export const AskEzyChangeStatus = z.enum(['proposed', 'applied', 'discarded']);
export type AskEzyChangeStatus = z.infer<typeof AskEzyChangeStatus>;

/** Where a proposed change goes (the MCP `update_ai_setup` targets). */
export const AskEzyChangeTarget = z.enum(['instructions', 'handoff_rules', 'context_text']);
export type AskEzyChangeTarget = z.infer<typeof AskEzyChangeTarget>;

export const AskEzyBlock = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stats'),
    items: z
      .array(
        z.object({
          label: short,
          value: z.string().trim().min(1).max(40),
          note: short.optional(),
          change: short.optional(),
          good: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(6),
  }),
  z.object({
    type: z.literal('bars'),
    title: short,
    finding: text(400).optional(),
    rows: z
      .array(z.object({ label: short, count: z.number().int().min(0) }))
      .min(1)
      .max(12),
  }),
  z.object({
    type: z.literal('heatmap'),
    title: short,
    finding: text(400).optional(),
    /** 7 weekdays (Monday first) × 24 hours, in the business time zone. */
    hours: z.array(z.array(z.number().min(0)).length(24)).length(7),
  }),
  z.object({
    type: z.literal('chats'),
    title: short,
    chats: z
      .array(
        z.object({
          jid: z.string().min(1).max(200),
          name: short,
          preview: z.string().max(300),
          wait: z.string().max(40),
          assignee: short.nullable(),
        }),
      )
      .min(1)
      .max(20),
  }),
  z.object({
    type: z.literal('customer'),
    jid: z.string().min(1).max(200),
    name: short,
    /** Facts the tools return (first message, message count, tags, assignee): never invented numbers. */
    facts: z.array(short).max(6),
    points: z.array(text(400)).max(8),
    open: z.array(text(400)).max(6),
    next: text(400),
  }),
  z.object({
    type: z.literal('change'),
    /** Server-made id of a pending change (never from the model). */
    id: z.string().min(1).max(64),
    /** The AI agent's name. */
    agent: short,
    /** What the change is about, in the user's language ("Delivery to Bayan Lepas"). */
    title: short,
    target: AskEzyChangeTarget,
    /** context_text: the Business context item's name. */
    itemName: short.nullable(),
    /** Lines added and removed (the page writes "Adds 1 line"). */
    added: z.number().int().min(0),
    removed: z.number().int().min(0),
    before: z.string().max(200_000),
    after: z.string().max(200_000),
    reason: text(600),
    test: AskEzyTest.optional(),
    status: AskEzyChangeStatus,
    version: z.number().int().positive().optional(),
  }),
  z.object({ type: z.literal('test'), ...AskEzyTest.shape }),
]);
export type AskEzyBlock = z.infer<typeof AskEzyBlock>;

/**
 * One thing Ezy read: the tool it used and how many items came back. The page shows it in the user's
 * language ("Read inbox statistics", "Read 12 chats"); tool inputs and outputs never reach it.
 */
export const AskEzyStep = z.object({
  key: z.string().min(1).max(64),
  count: z.number().int().min(0).optional(),
});
export type AskEzyStep = z.infer<typeof AskEzyStep>;

export const AskEzyAnswer = z.object({
  text: text(ASK_EZY_ANSWER_CHARACTERS),
  blocks: z.array(AskEzyBlock).max(8),
  /** What Ezy read, in call order (repeated calls of one tool merged). */
  steps: z.array(AskEzyStep).max(12),
  followUps: z.array(short).max(4),
});
export type AskEzyAnswer = z.infer<typeof AskEzyAnswer>;

/** One NDJSON line of the `POST /api/ask-ezy` stream. */
export const AskEzyEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step'), ...AskEzyStep.shape }),
  z.object({ type: z.literal('answer'), answer: AskEzyAnswer }),
  z.object({ type: z.literal('error'), code: z.string().min(1).max(64) }),
]);
export type AskEzyEvent = z.infer<typeof AskEzyEvent>;

/** `POST /api/ask-ezy/changes/:id/{apply|discard|undo}` answer (admins only). */
export const AskEzyChangeResult = z.object({
  status: AskEzyChangeStatus,
  version: z.number().int().positive().optional(),
});
export type AskEzyChangeResult = z.infer<typeof AskEzyChangeResult>;

/** `GET /api/ask-ezy/status`: whether the AI connection can answer now (the panel checks it on open). */
export const AskEzyStatus = z.object({ connected: z.boolean() });
export type AskEzyStatus = z.infer<typeof AskEzyStatus>;
