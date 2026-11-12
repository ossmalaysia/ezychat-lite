import { z } from 'zod';
import { AiAgentPreset } from './ai.js';
import { ScheduledDayRule } from './scheduled-tasks.js';

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

/** A question choice: a short label the panel shows as a chip and sends back as the next turn. */
export const ASK_EZY_CHOICE_CHARACTERS = 80;
export const ASK_EZY_CHOICES_MAX = 4;

/** What a scheduled task card shows (design docs/features/ask-ezy-setup/design.md). */
const AskEzyTaskFields = {
  /** The task's name. */
  name: short,
  time: z.string().regex(/^\d\d:\d\d$/),
  dayRule: ScheduledDayRule,
  days: z.array(z.number().int().min(0).max(6)).max(7),
  /** null: the chat has no name (the page writes "Chat …6789"); never a whole phone number. */
  chatName: short.nullable(),
  /** The last 4 digits of the chat's number; null for a group or a chat without a number. */
  chatEnding: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  chatType: z.enum(['dm', 'group']),
  instruction: text(1000),
};

export const AskEzyTaskBefore = z.object({
  name: short.optional(),
  time: AskEzyTaskFields.time.optional(),
  dayRule: ScheduledDayRule.optional(),
  days: AskEzyTaskFields.days.optional(),
  chatName: short.nullable().optional(),
  chatEnding: AskEzyTaskFields.chatEnding.optional(),
  instruction: text(1000).optional(),
});
export type AskEzyTaskBefore = z.infer<typeof AskEzyTaskBefore>;

export const AskEzyBlock = z.discriminatedUnion('type', [
  /** Ezy needs one detail: the person taps a choice (sent as their next turn) or types an answer. */
  z.object({
    type: z.literal('question'),
    text: text(400),
    choices: z
      .array(z.string().trim().min(1).max(ASK_EZY_CHOICE_CHARACTERS))
      .min(1)
      .max(ASK_EZY_CHOICES_MAX),
    /** Why Ezy asks (the agent limit, a chat on another number), shown above the question. */
    note: text(400).optional(),
    tone: z.enum(['warning', 'error']).optional(),
  }),
  /** A new AI agent Ezy proposed (admins); Apply creates it switched off. */
  z.object({
    type: z.literal('agent_proposal'),
    /** Server-made id of the pending proposal (never from the model). */
    id: z.string().min(1).max(64),
    name: short,
    preset: AiAgentPreset,
    /** The WhatsApp number (inbox) it will serve. */
    inboxName: short,
    /** What it will do, in the person's language. */
    note: text(300).nullable(),
    status: AskEzyChangeStatus,
    /** The created agent (applied). */
    agentId: z.number().int().positive().optional(),
    /** Undo can remove the created agent (false in an edition with one agent: it stays, switched off). */
    removable: z.boolean().optional(),
  }),
  /** A new scheduled task, or a change to one (`taskId` + `before`), that Ezy proposed (admins). */
  z.object({
    type: z.literal('task_proposal'),
    id: z.string().min(1).max(64),
    /** The agent's name ("(new)" is added by the page while `dependsOn` is set). */
    agent: short,
    /** The agent; null while it is a pending new agent (`dependsOn`). */
    agentId: z.number().int().positive().nullable(),
    /** The id of the pending new-agent proposal this task needs first. */
    dependsOn: z.string().min(1).max(64).nullable(),
    ...AskEzyTaskFields,
    /** The business time zone the time is read in (`ai_timezone`). */
    timeZone: short,
    /** One message the agent would send now (nothing sent or stored); null when there is none. */
    preview: z.string().max(4000).nullable(),
    /** An edit: the saved values of the fields it changes. */
    before: AskEzyTaskBefore.nullable(),
    /** The task (an edit, or applied). */
    taskId: z.number().int().positive().optional(),
    status: AskEzyChangeStatus,
  }),
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

/**
 * `POST /api/ask-ezy/changes/:id/{apply|discard|undo}` answer (admins only). The id is a setup change, a new
 * agent or a scheduled task proposal.
 */
export const AskEzyChangeResult = z.object({
  status: AskEzyChangeStatus,
  version: z.number().int().positive().optional(),
  /** Other proposals the same request moved ("Apply both": the new agent; Undo of both). */
  related: z
    .array(z.object({ id: z.string().min(1).max(64), status: AskEzyChangeStatus }))
    .optional(),
  /** The agent the proposal created or uses, and the task (agent and task proposals). */
  agentId: z.number().int().positive().optional(),
  taskId: z.number().int().positive().optional(),
  /** A saved task: its next time (epoch ms) and whether its agent is on (it sends only then). */
  nextRunAt: z.number().nullable().optional(),
  agentOn: z.boolean().optional(),
  /** "Apply both": the new agent was created but the task was not saved (`related` says so). */
  failed: z.object({ code: z.string().min(1).max(64), message: z.string().max(500) }).optional(),
});
export type AskEzyChangeResult = z.infer<typeof AskEzyChangeResult>;

/** `GET /api/ask-ezy/status`: whether the AI connection can answer now (the panel checks it on open). */
export const AskEzyStatus = z.object({ connected: z.boolean() });
export type AskEzyStatus = z.infer<typeof AskEzyStatus>;
