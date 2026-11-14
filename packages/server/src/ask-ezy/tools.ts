import { errorNameOf } from '../ai/agent/models.js';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import {
  AI_INSTRUCTIONS_CHARACTERS,
  AskEzyChangeTarget,
  ScheduledDayRule,
  type AskEzyTest,
  type User,
} from '@ezychat/shared';
import { INBOX_TOOLS, ToolError, type ToolContext, type ToolDef } from '../mcp/tools.js';
import { AI_SETUP_TOOLS } from '../mcp/ai-tools.js';
import type { InboxReadPort } from '../mcp/inbox.js';
import { AiSetupError, type AiSetupPort } from '../mcp/ai-setup.js';
import { SendError, type InboxSendPort } from '../mcp/send.js';
import { HttpError } from '../http/errors.js';
import { ProposeError, type ChangeStore } from './changes.js';
import type { SetupStore } from './setup.js';

/**
 * Ask Ezy's tools: the MCP tools the signed-in user's role allows (same definitions, so a new MCP tool works
 * here too), never the send tools and never `update_ai_setup`. Admins get `propose_ai_setup_change`
 * instead, which only records a change for the admin's Apply.
 */
export const ASK_EZY_MEMBER_TOOLS: readonly string[] = [
  'list_chats',
  'get_chat',
  'get_messages',
  'get_stats',
  'get_activity',
];
export const ASK_EZY_ADMIN_TOOLS: readonly string[] = [
  ...ASK_EZY_MEMBER_TOOLS,
  'list_ai_agents',
  'get_ai_agent_setup',
  'get_ai_context_item',
  'get_ai_setup_history',
  'get_ai_setup_version',
  'try_ai_reply',
  'propose_ai_setup_change',
];
/**
 * The setup turn (after `start_setup`, on the main model) adds these; a normal admin turn has only
 * `start_setup` instead.
 */
export const ASK_EZY_SETUP_TOOLS: readonly string[] = [
  'list_scheduled_tasks',
  'propose_agent',
  'propose_scheduled_task',
  'propose_scheduled_task_edit',
];

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5][05]$/)
  .describe('HH:MM, 24-hour, in 5-minute steps, in the business time zone (never ask for a zone)');
const days = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .describe('dayRule custom only: 0 = Sunday … 6 = Saturday');
const chatJid = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'The chat id (jid) a list_chats look-up returned in this answer, never one you made up',
  );

export const ProposeAgentInput = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .describe(
      'A name from what it does, e.g. "Morning greeter"; never generic ("New AI agent", "Assistant") nor an existing agent\'s name',
    ),
  inboxId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('The WhatsApp number (inbox id) it serves; needed only with more than one number'),
  instructions: z
    .string()
    .max(AI_INSTRUCTIONS_CHARACTERS)
    .optional()
    .describe(
      'Optional extra detail for its instructions (tone, what to mention); the server writes its role from purpose',
    ),
  purpose: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe(
      'What it sends, to whom and when, one sentence in the person\'s language (e.g. "Sends Jee Fong a warm good-morning greeting every day at 9am"); its instructions are written from it',
    ),
});

export const ProposeTaskInput = z.strictObject({
  agentId: z.number().int().positive().optional().describe('An existing agent (list_ai_agents)'),
  agentProposalId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Or: the proposalId propose_agent returned (the task waits for the new agent)'),
  chatJid,
  name: z.string().trim().min(1).max(60).describe('A short task name, e.g. "Morning greeting"'),
  time,
  dayRule: ScheduledDayRule.describe('daily, weekdays (Monday to Friday) or custom days'),
  days: days.optional(),
  instruction: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .describe('What the agent writes each time, in plain words'),
});

export const ProposeTaskEditInput = z.strictObject({
  taskId: z.number().int().positive().describe('taskId from list_scheduled_tasks'),
  name: ProposeTaskInput.shape.name.optional(),
  time: time.optional(),
  dayRule: ScheduledDayRule.optional(),
  days: days.optional(),
  chatJid: chatJid.optional(),
  instruction: ProposeTaskInput.shape.instruction.optional(),
});

const ListTasksInput = z.strictObject({
  agentId: z.number().int().positive().optional().describe('One agent; omit for every agent'),
});

/** Tools whose results name chats a later proposal may use (their ids are kept for this answer). */
const CHAT_LOOKUPS = new Set(['list_chats', 'get_chat']);

const TARGET = AskEzyChangeTarget.describe(
  'instructions = AI instructions; handoff_rules = hand-off rules; context_text = a Business context text item',
);

/** Small Business context texts come with the setup read (one model round trip less each). */
export const INLINE_ITEM_CHARACTERS = 6_000;
export const INLINE_TOTAL_CHARACTERS = 12_000;

export const EditInput = z.strictObject({
  agentId: z
    .number()
    .int()
    .positive()
    .describe('The agent (agentId from the prompt or list_ai_agents)'),
  target: TARGET,
  itemId: z.number().int().positive().optional().describe('context_text only: the item to change'),
  edits: z
    .array(
      z.strictObject({
        find: z
          .string()
          .min(1)
          .max(4000)
          .describe(
            'An exact piece of the saved text, copied from what you read; it must occur once',
          ),
        replace: z
          .string()
          .max(8000)
          .describe(
            'Its new text ("" removes it). To add a line, find the line before it and replace it with that line plus the new one.',
          ),
      }),
    )
    .min(1)
    .max(10),
});

export const TryInput = z.strictObject({
  agentId: z.number().int().positive().optional().describe('The agent; not needed with draftId'),
  messages: z
    .array(z.string().trim().min(1).max(500))
    .min(1)
    .max(3)
    .describe('1-3 customer messages to test, real ones from the chats when you have them'),
  draftId: z
    .string()
    .max(16)
    .optional()
    .describe(
      'A draft from edit_ai_setup_text: each message is answered with the saved setup AND the draft at the same time',
    ),
});

export const ProposeInput = z.strictObject({
  draftId: z
    .string()
    .max(16)
    .optional()
    .describe(
      'The draft from edit_ai_setup_text (then no agentId, target or text): the server proposes its text and adds the test you ran',
    ),
  agentId: z.number().int().positive().optional().describe('Without draftId: agentId'),
  target: TARGET.optional(),
  itemId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('context_text only: the item to change; omit to add a new text item'),
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe('context_text only: the new item name'),
  text: z
    .string()
    .max(200_000)
    .optional()
    .describe(
      'Without draftId only, for a new Business context item: the complete text. One line per paragraph or list item.',
    ),
  reason: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .describe('Why, from what you read (e.g. "4 customers asked about Bayan Lepas")'),
});

export interface AskEzyToolDeps {
  user: User;
  inbox: InboxReadPort;
  aiSetup: AiSetupPort;
  changes: ChangeStore;
  setup: SetupStore;
  /** The Ask Ezy request's signal: a proposal preview stops with it. */
  signal?: AbortSignal;
  /**
   * Admins: `normal` offers `start_setup` (calls `onStartSetup`), `setup` offers the setup tools instead
   * (the main-model turn after `start_setup`). Default `normal`.
   */
  mode?: 'normal' | 'setup';
  onStartSetup?: () => void;
  /** One line per call for the log and the live steps: tool name, rows, ok. Never inputs or outputs. */
  /** `errName`: an unexpected failure's error class (never its message, which can hold chat text). */
  onCall: (call: {
    tool: string;
    count: number;
    ok: boolean;
    ms: number;
    errName?: string;
  }) => void;
}

const neverSend: InboxSendPort = new Proxy({} as InboxSendPort, {
  get: () => () => {
    throw new ToolError('Ask Ezy never sends messages');
  },
});

const UNEXPECTED_FAILURE = 'The tool failed. Try another way or answer with what you have.';

/** Expected failures go back to the model as text; anything else is a short fixed message. */
function failure(err: unknown): string {
  if (
    err instanceof ToolError ||
    err instanceof AiSetupError ||
    err instanceof SendError ||
    err instanceof ProposeError ||
    err instanceof HttpError
  )
    return err.message;
  return UNEXPECTED_FAILURE;
}

export function askEzyTools(deps: AskEzyToolDeps): ToolSet {
  const isAdmin = deps.user.role === 'admin';
  const allowed = new Set(isAdmin ? ASK_EZY_ADMIN_TOOLS : ASK_EZY_MEMBER_TOOLS);
  const context: ToolContext = {
    inbox: deps.inbox,
    aiSetup: deps.aiSetup,
    send: neverSend,
    // No token: the rate limits of the AI-setup tools count per user (a negative id never matches a token).
    principal: { tokenId: -deps.user.id, user: deps.user, scopes: new Set() },
  };
  const tools: ToolSet = {};
  const run = async <T>(
    name: string,
    fn: () => Promise<{ result: T; count: number }> | { result: T; count: number },
  ) => {
    const started = performance.now();
    try {
      const { result, count } = await fn();
      deps.onCall({ tool: name, count, ok: true, ms: Math.round(performance.now() - started) });
      return result;
    } catch (err) {
      const message = failure(err);
      deps.onCall({
        tool: name,
        count: 0,
        ok: false,
        ms: Math.round(performance.now() - started),
        ...(message === UNEXPECTED_FAILURE ? { errName: errorNameOf(err) ?? 'Error' } : {}),
      });
      return { error: message };
    }
  };
  /** Chat ids the look-ups of this answer returned: the only ones a task proposal may name. */
  const seen = new Set<string>();
  const remember = (name: string, result: unknown) => {
    if (!CHAT_LOOKUPS.has(name) || !result || typeof result !== 'object') return;
    const r = result as { chats?: Array<{ jid?: unknown }>; chat?: { jid?: unknown } };
    for (const c of [...(r.chats ?? []), ...(r.chat ? [r.chat] : [])])
      if (typeof c.jid === 'string') seen.add(c.jid);
  };
  /** Adds the text of small Business context text items to a setup read (each one a round trip less). */
  const withSmallTexts = (result: unknown) => {
    const r = result as {
      agentId?: number | null;
      businessContext?: Array<{ id: number; kind: string; characters: number }>;
    };
    if (!Array.isArray(r.businessContext)) return result;
    let budget = INLINE_TOTAL_CHARACTERS;
    const businessContext = r.businessContext.map((d) => {
      if (d.kind !== 'text' || d.characters > INLINE_ITEM_CHARACTERS || d.characters > budget)
        return d;
      try {
        const doc = deps.aiSetup.contextItem(d.id, r.agentId ?? undefined);
        if (doc.truncated) return d;
        budget -= d.characters;
        return { ...d, text: doc.text };
      } catch {
        return d;
      }
    });
    return { ...r, businessContext };
  };
  const DESCRIPTION_NOTE: Record<string, string> = {
    get_ai_agent_setup:
      ' Small text items come with their text here: read only the items without text with get_ai_context_item.',
  };
  for (const def of [...INBOX_TOOLS, ...AI_SETUP_TOOLS] as ToolDef[]) {
    if (!allowed.has(def.name)) continue;
    tools[def.name] = tool({
      description: def.description + (DESCRIPTION_NOTE[def.name] ?? ''),
      inputSchema: def.input,
      execute: (args) =>
        run(def.name, async () => {
          const out = await def.run(def.input.parse(args), context);
          remember(def.name, out.result);
          return def.name === 'get_ai_agent_setup'
            ? { ...out, result: withSmallTexts(out.result) }
            : out;
        }),
    });
  }
  if (isAdmin && deps.mode !== 'setup')
    tools.start_setup = tool({
      description:
        'Call this (and nothing else) when the admin wants to create a new AI agent, or create, move or change a scheduled task (a message an agent sends at set times), e.g. "a new agent that greets Jee Fong at 9am" or "move the morning greeting to 8:30". A setup assistant then takes over this question. Not for improving how an existing agent answers chats (its instructions, hand-off rules or business context): use propose_ai_setup_change for that.',
      inputSchema: z.strictObject({}),
      execute: () =>
        run('start_setup', () => {
          deps.onStartSetup?.();
          return { result: { started: true }, count: 0 };
        }),
    });
  if (isAdmin && deps.mode === 'setup') {
    tools.list_scheduled_tasks = tool({
      description:
        "Lists the AI agents' scheduled tasks (taskId, agent, name, time, days, chat, instruction, on/off) in the business time zone. Read it before changing a task.",
      inputSchema: ListTasksInput,
      execute: (args) =>
        run('list_scheduled_tasks', () => {
          const tasks = deps.setup.listTasks(deps.user, ListTasksInput.parse(args).agentId);
          for (const task of tasks) if (task.chatJid) seen.add(task.chatJid);
          return { result: { tasks }, count: tasks.length };
        }),
    });
    tools.propose_agent = tool({
      description:
        "Proposes a new AI agent that sends scheduled messages (it never answers chats; the server writes its instructions from purpose). Always propose its scheduled task in the same answer: call propose_scheduled_task with agentProposalId, then add both blocks; a new agent without its task is left out. Nothing is created: the admin applies both with one button, and the agent starts switched off. Refused at the edition's agent limit (then offer an existing agent) and for a generic name. Returns proposalId: add a block {type: 'agent_proposal', json: '{\"id\":\"<proposalId>\"}'}.",
      inputSchema: ProposeAgentInput,
      execute: (args) =>
        run('propose_agent', () => {
          const p = deps.setup.proposeAgent(deps.user, ProposeAgentInput.parse(args));
          return { result: { proposalId: p.id, saved: false }, count: 1 };
        }),
    });
    tools.propose_scheduled_task = tool({
      description:
        "Proposes a scheduled task: the agent sends one message at a set time on its days to ONE existing chat or group of the agent's WhatsApp number. Nothing is saved or sent: the admin sees a card with a preview and decides with Apply. Look the chat up with list_chats first. Returns proposalId: add a block {type: 'task_proposal', json: '{\"id\":\"<proposalId>\"}'}.",
      inputSchema: ProposeTaskInput,
      execute: (args) =>
        run('propose_scheduled_task', async () => {
          const p = await deps.setup.proposeTask(
            deps.user,
            ProposeTaskInput.parse(args),
            seen,
            deps.signal,
          );
          return {
            result: { proposalId: p.id, saved: false, preview: p.preview !== null },
            count: 1,
          };
        }),
    });
    tools.propose_scheduled_task_edit = tool({
      description:
        'Proposes a change to an existing scheduled task (only the fields that change). Nothing is saved: the admin sees before → after and decides with Apply. Read list_scheduled_tasks first. Returns proposalId: add a block {type: \'task_proposal\', json: \'{"id":"<proposalId>"}\'}.',
      inputSchema: ProposeTaskEditInput,
      execute: (args) =>
        run('propose_scheduled_task_edit', async () => {
          const p = await deps.setup.proposeTaskEdit(
            deps.user,
            ProposeTaskEditInput.parse(args),
            seen,
            deps.signal,
          );
          return { result: { proposalId: p.id, saved: false }, count: 1 };
        }),
    });
  }
  if (isAdmin) {
    /**
     * Drafts of this answer: the model sends only the parts that change, and the full text never goes through the
     * model again (test and proposal take the draftId). Output tokens are most of a turn's time.
     */
    const drafts = new Map<
      string,
      {
        agentId: number;
        target: AskEzyChangeTarget;
        itemId?: number;
        text: string;
        test?: AskEzyTest;
      }
    >();
    tools.edit_ai_setup_text = tool({
      description:
        "Drafts a change to an AI agent's AI instructions, hand-off rules or a Business context text item: send only the parts that change (find → replace), never the whole text. Nothing is saved. Returns draftId for try_ai_reply and propose_ai_setup_change.",
      inputSchema: EditInput,
      execute: (args) =>
        run('edit_ai_setup_text', () => {
          const input = EditInput.parse(args);
          let text: string;
          if (input.target === 'context_text') {
            if (input.itemId === undefined)
              throw new ToolError(
                'Give itemId. To add a new item, call propose_ai_setup_change with its name and text.',
              );
            const doc = deps.aiSetup.contextItem(input.itemId, input.agentId);
            if (doc.kind !== 'text' || doc.truncated)
              throw new ToolError('Only whole text items can be changed');
            text = doc.text;
          } else {
            const setup = deps.aiSetup.setup(input.agentId);
            if (setup.agentId !== input.agentId)
              throw new ToolError('Unknown agentId: call list_ai_agents first');
            text = input.target === 'instructions' ? setup.instructions : setup.handoffRules;
          }
          for (const [i, e] of input.edits.entries()) {
            const at = text.indexOf(e.find);
            if (at < 0)
              throw new ToolError(
                `Edit ${i + 1}: this find text is not in the saved text. Copy it exactly from what you read.`,
              );
            if (text.indexOf(e.find, at + 1) >= 0)
              throw new ToolError(
                `Edit ${i + 1}: this find text occurs more than once. Make it longer.`,
              );
            text = text.slice(0, at) + e.replace + text.slice(at + e.find.length);
          }
          const draftId = `d${drafts.size + 1}`;
          drafts.set(draftId, {
            agentId: input.agentId,
            target: input.target,
            ...(input.itemId !== undefined ? { itemId: input.itemId } : {}),
            text,
          });
          return { result: { draftId, characters: text.length, saved: false }, count: 1 };
        }),
    });
    tools.try_ai_reply = tool({
      description:
        "Shows how an AI agent answers 1-3 customer messages and whether it hands the chat to the team. With draftId, each message is answered with the saved setup AND the draft at the same time (one call for before and after); the first result becomes the change card's test. Touches no chat and saves nothing, but uses the AI connection (10 answers a minute).",
      inputSchema: TryInput,
      execute: (args) =>
        run('try_ai_reply', async () => {
          const input = TryInput.parse(args);
          const draft = input.draftId ? drafts.get(input.draftId) : undefined;
          if (input.draftId && !draft)
            throw new ToolError('Unknown draftId: call edit_ai_setup_text first');
          if (draft?.target === 'context_text')
            throw new ToolError(
              'A Business context draft cannot be tested here: propose it with its draftId',
            );
          const agentId = draft?.agentId ?? input.agentId;
          const answer = async (message: string, withDraft: boolean) => {
            deps.aiSetup.allow('try', context.principal.tokenId);
            const r = await deps.aiSetup.tryReply({
              ...(agentId !== undefined ? { agentId } : {}),
              message,
              ...(withDraft && draft
                ? draft.target === 'instructions'
                  ? { instructions: draft.text }
                  : { handoffRules: draft.text }
                : {}),
            });
            if (!r.ok) throw new ToolError(r.error ?? 'The AI could not answer');
            return { reply: r.reply, action: r.action, handoffReason: r.handoffReason ?? null };
          };
          const results = await Promise.all(
            input.messages.map(async (message) => {
              const [saved, drafted] = await Promise.all([
                answer(message, false),
                draft ? answer(message, true) : Promise.resolve(null),
              ]);
              return { message, saved, ...(drafted ? { draft: drafted } : {}) };
            }),
          );
          const first = results[0]!;
          if (draft && first.saved.reply && first.draft?.reply)
            draft.test = {
              question: first.message.slice(0, 1000),
              before: first.saved.reply.slice(0, 2000),
              after: first.draft.reply.slice(0, 2000),
            };
          return { result: { results }, count: results.length };
        }),
    });
    tools.propose_ai_setup_change = tool({
      description:
        'Proposes a change to an AI agent\'s AI instructions, hand-off rules or a Business context text item for the admin\'s Apply. Nothing is saved. Give the draftId from edit_ai_setup_text (test it first with try_ai_reply when it changes how the agent answers); write a complete text only for a new Business context item (agentId, target context_text, name, text). Returns changeId: add a block {type: \'change\', json: \'{"id":"<changeId>","title":"<short title>"}\'} (the server adds the test you ran).',
      inputSchema: ProposeInput,
      execute: (args) =>
        run('propose_ai_setup_change', () => {
          const input = ProposeInput.parse(args);
          const draft = input.draftId ? drafts.get(input.draftId) : undefined;
          if (input.draftId && !draft)
            throw new ProposeError('Unknown draftId: call edit_ai_setup_text first');
          if (!draft && (input.agentId === undefined || !input.target || input.text === undefined))
            throw new ProposeError('Give draftId, or agentId, target and the complete text');
          const change = deps.changes.propose(
            deps.user,
            draft
              ? {
                  agentId: draft.agentId,
                  target: draft.target,
                  ...(draft.itemId !== undefined ? { itemId: draft.itemId } : {}),
                  text: draft.text,
                  reason: input.reason,
                  ...(draft.test ? { test: draft.test } : {}),
                }
              : {
                  agentId: input.agentId!,
                  target: input.target!,
                  ...(input.itemId !== undefined ? { itemId: input.itemId } : {}),
                  ...(input.name !== undefined ? { name: input.name } : {}),
                  text: input.text!,
                  reason: input.reason,
                },
          );
          return { result: { changeId: change.id, saved: false }, count: 1 };
        }),
    });
  }
  return tools;
}
