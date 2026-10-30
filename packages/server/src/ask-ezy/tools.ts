import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { AskEzyChangeTarget, type User } from '@ezychat/shared';
import { INBOX_TOOLS, ToolError, type ToolContext, type ToolDef } from '../mcp/tools.js';
import { AI_SETUP_TOOLS } from '../mcp/ai-tools.js';
import type { InboxReadPort } from '../mcp/inbox.js';
import { AiSetupError, type AiSetupPort } from '../mcp/ai-setup.js';
import { SendError, type InboxSendPort } from '../mcp/send.js';
import { HttpError } from '../http/errors.js';
import { ProposeError, type ChangeStore } from './changes.js';

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
  /** One line per call for the log and the live steps: tool name, rows, ok. Never inputs or outputs. */
  onCall: (call: { tool: string; count: number; ok: boolean; ms: number }) => void;
}

const neverSend: InboxSendPort = new Proxy({} as InboxSendPort, {
  get: () => () => {
    throw new ToolError('Ask Ezy never sends messages');
  },
});

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
  return 'The tool failed. Try another way or answer with what you have.';
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
      deps.onCall({ tool: name, count: 0, ok: false, ms: Math.round(performance.now() - started) });
      return { error: failure(err) };
    }
  };
  for (const def of [...INBOX_TOOLS, ...AI_SETUP_TOOLS] as ToolDef[]) {
    if (!allowed.has(def.name)) continue;
    tools[def.name] = tool({
      description: def.description,
      inputSchema: def.input,
      execute: (args) => run(def.name, () => def.run(def.input.parse(args), context)),
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
