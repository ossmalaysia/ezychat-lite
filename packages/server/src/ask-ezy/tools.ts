import { errorNameOf } from '../ai/agent/models.js';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import {
  AI_INSTRUCTIONS_CHARACTERS,
  AskEzyChangeTarget,
  ScheduledDayRule,
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

export const ProposeInput = z.strictObject({
  agentId: z.number().int().positive().describe('agentId from list_ai_agents'),
  target: AskEzyChangeTarget.describe(
    'instructions = AI instructions; handoff_rules = hand-off rules; context_text = a Business context text item',
  ),
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
    .describe('The complete new text (not a diff). One line per paragraph or list item.'),
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
  for (const def of [...INBOX_TOOLS, ...AI_SETUP_TOOLS] as ToolDef[]) {
    if (!allowed.has(def.name)) continue;
    tools[def.name] = tool({
      description: def.description,
      inputSchema: def.input,
      execute: (args) =>
        run(def.name, async () => {
          const out = await def.run(def.input.parse(args), context);
          remember(def.name, out.result);
          return out;
        }),
    });
  }
  if (isAdmin && deps.mode !== 'setup')
    tools.start_setup = tool({
      description:
        'Call this (and nothing else) when the admin wants to create or change an AI agent or a scheduled task (a message an agent sends at set times), e.g. "a new agent that greets Jee Fong at 9am" or "move the morning greeting to 8:30". A setup assistant then takes over this question.',
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
  if (isAdmin)
    tools.propose_ai_setup_change = tool({
      description:
        'Proposes a change to an AI agent\'s AI instructions, hand-off rules or a Business context text item. Nothing is saved: the admin sees the change as a card and decides with Apply. Send the complete new text. Test it first with try_ai_reply when it changes how the agent answers. Returns changeId: add a block {type: \'change\', json: \'{"id":"<changeId>","title":"<short title>","test":{...}}\'} to your answer.',
      inputSchema: ProposeInput,
      execute: (args) =>
        run('propose_ai_setup_change', () => {
          const change = deps.changes.propose(deps.user, ProposeInput.parse(args));
          return { result: { changeId: change.id, saved: false }, count: 1 };
        }),
    });
  return tools;
}
