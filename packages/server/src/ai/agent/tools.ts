import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import {
  AI_FULL_CONTEXT_CHARACTERS,
  relevantKnowledge,
  type KnowledgeSource,
} from '../knowledge.js';
import type { AiConversationTurn } from '../prompt.js';

/** Characters a tool may return to the model in one call. */
export const AI_TOOL_OUTPUT_CHARACTERS = 12_000;
/** Messages `get_older_messages` returns per page. */
export const AI_OLDER_MESSAGES_PAGE = 20;

const capped = (text: string) =>
  text.length > AI_TOOL_OUTPUT_CHARACTERS
    ? `${text.slice(0, AI_TOOL_OUTPUT_CHARACTERS)}\n[…more not shown]`
    : text;

export interface ChatToolContext {
  /** This AI member's Business context. */
  knowledge: readonly KnowledgeSource[];
  /**
   * Page `n` (1 = just before the messages in the prompt) of THIS chat's older messages, oldest
   * first. Absent when the prompt already holds the whole chat.
   */
  olderMessages?: (page: number) => AiConversationTurn[];
  /** Called with each tool name the model uses (for the decision log; never inputs or outputs). */
  onCall?: (name: string) => void;
}

/**
 * The read tools the model may use for one chat. Each is bound to this chat by the server: no tool
 * input names a chat, phone or person, so a message cannot make the AI read another customer.
 * Tools are offered only when useful, so most replies stay a single model call.
 */
export function chatTools(context: ChatToolContext): ToolSet {
  const tools: ToolSet = {};
  const total = context.knowledge.reduce((sum, source) => sum + source.text.length, 0);
  // Small knowledge is already in the prompt in full; search only helps when it was selected.
  if (total > AI_FULL_CONTEXT_CHARACTERS)
    tools.search_business_context = tool({
      description:
        "Search the business's own facts (products, prices, hours, delivery, policies) when the " +
        'supplied business knowledge does not answer the question. Search again with other words ' +
        'if the first result does not help.',
      inputSchema: z.object({ query: z.string().min(1).max(200) }),
      execute: async ({ query }) => {
        context.onCall?.('search_business_context');
        return capped(relevantKnowledge([...context.knowledge], query));
      },
    });
  const older = context.olderMessages;
  if (older)
    tools.get_older_messages = tool({
      description:
        'Read earlier messages of this conversation (before the ones supplied), oldest first. ' +
        'Use it only when something said earlier matters to the answer.',
      inputSchema: z.object({
        page: z
          .number()
          .int()
          .min(1)
          .max(5)
          .describe('1 = the messages just before the supplied ones'),
      }),
      execute: async ({ page }) => {
        context.onCall?.('get_older_messages');
        const turns = older(page);
        return turns.length ? capped(JSON.stringify(turns)) : 'No earlier messages.';
      },
    });
  return tools;
}
