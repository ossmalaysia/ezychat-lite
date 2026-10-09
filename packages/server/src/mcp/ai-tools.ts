import {
  McpGetAiAgentSetupInput,
  McpGetAiContextItemInput,
  McpGetAiSetupHistoryInput,
  McpTryAiReplyInput,
  McpUpdateAiSetupInput,
} from '@wa-team-inbox/shared';
import { ToolError, type ToolDef } from './tools.js';

/** Business context text returned per call; longer items are cut and flagged `truncated`. */
const MAX_ITEM_CHARS = 20_000;
/** Text of one version in get_ai_setup_history. */
const MAX_VERSION_CHARS = 8_000;

const iso = (t: number) => new Date(t).toISOString();
const cut = (text: string, max: number) =>
  text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };

const getAiAgentSetup: ToolDef<typeof McpGetAiAgentSetupInput> = {
  name: 'get_ai_agent_setup',
  title: 'Read the AI Sales Agent setup',
  description:
    "The AI Sales Agent's current AI instructions, hand-off rules, on/off state and the list of Business context items (read one with get_ai_context_item). Hand-offs in chats name the rule type that fired; compare with get_stats → ai.",
  scope: 'ai:setup',
  input: McpGetAiAgentSetupInput,
  run(_args, { aiSetup }) {
    const setup = aiSetup.setup();
    return {
      result: {
        ...setup,
        businessContext: setup.businessContext.map((d) => ({ ...d, updatedAt: iso(d.updatedAt) })),
      },
      count: 1 + setup.businessContext.length,
    };
  },
};

const getAiContextItem: ToolDef<typeof McpGetAiContextItemInput> = {
  name: 'get_ai_context_item',
  title: 'Read a Business context item',
  description:
    'The full text of one Business context item (what the AI answers from). Text items can be changed with update_ai_setup; uploaded files are read-only.',
  scope: 'ai:setup',
  input: McpGetAiContextItemInput,
  run(args, { aiSetup }) {
    const item = aiSetup.contextItem(args.id);
    const body = cut(item.text, MAX_ITEM_CHARS);
    return {
      result: {
        id: item.id,
        name: item.name,
        kind: item.kind,
        editable: item.kind === 'text',
        characters: item.characters,
        updatedAt: iso(item.updatedAt),
        text: body.text,
        truncated: body.truncated || item.truncated,
      },
      count: 1,
    };
  },
};

const tryAiReply: ToolDef<typeof McpTryAiReplyInput> = {
  name: 'try_ai_reply',
  title: 'Test an AI reply',
  description:
    'Shows how the AI Sales Agent would answer a customer message, with the saved setup or with draft instructions / hand-off rules, and whether it would hand the chat to the team (and why). Touches no chat and saves nothing, but uses the owner’s AI connection (limited to 10 a minute).',
  scope: 'ai:setup',
  input: McpTryAiReplyInput,
  async run(args, { aiSetup, principal }) {
    aiSetup.allow('try', principal.tokenId);
    const r = await aiSetup.tryReply(args);
    if (!r.ok) throw new ToolError(r.error ?? 'The AI could not answer');
    return {
      result: {
        reply: r.reply,
        action: r.action,
        handoffReason: r.handoffReason ?? null,
        model: r.model,
        usedDraft: {
          instructions: args.instructions !== undefined,
          handoffRules: args.handoffRules !== undefined,
        },
      },
      count: 1,
    };
  },
};

const updateAiSetup: ToolDef<typeof McpUpdateAiSetupInput> = {
  name: 'update_ai_setup',
  title: 'Change the AI Sales Agent setup',
  description:
    'Saves new AI instructions, hand-off rules, or a Business context text item (add or replace; send the complete text). Takes effect for customers right away. Only change what the admin you are working with asked for; test with try_ai_reply first. Every change is kept in the version history (get_ai_setup_history) and the audit log with your reason. Limited to 20 changes an hour.',
  scope: 'ai:setup',
  readOnly: false,
  input: McpUpdateAiSetupInput,
  run(args, { aiSetup, principal }) {
    aiSetup.allow('update', principal.tokenId);
    const { versionId } = aiSetup.update(args, principal);
    return { result: { saved: true, target: args.target, versionId }, count: 1 };
  },
};

const getAiSetupHistory: ToolDef<typeof McpGetAiSetupHistoryInput> = {
  name: 'get_ai_setup_history',
  title: 'AI setup version history',
  description:
    'Saved versions of the AI instructions, hand-off rules or a Business context text item, newest first: who changed it (in the app or by an AI assistant over MCP), when, why, and the full text. To revert, send an older text back with update_ai_setup.',
  scope: 'ai:setup',
  input: McpGetAiSetupHistoryInput,
  run(args, { aiSetup, inbox }) {
    if (args.target !== 'context_text' && args.itemId !== undefined)
      throw new ToolError('itemId applies to context_text only');
    if (args.target === 'context_text' && args.itemId === undefined)
      throw new ToolError('Give the itemId of the Business context text item');
    const names = inbox.userNames();
    const versions = aiSetup.history(args.target, args.itemId ?? null, args.limit);
    return {
      result: {
        versions: versions.map((v) => {
          const body = cut(v.content, MAX_VERSION_CHARS);
          return {
            versionId: v.id,
            at: iso(v.createdAt),
            changedIn:
              v.via === 'mcp' ? 'AI assistant (MCP)' : v.via === 'app' ? 'app' : 'original text',
            by: v.userId === null ? null : (names.get(v.userId) ?? `user ${v.userId}`),
            tokenId: v.tokenId,
            reason: v.reason,
            text: body.text,
            ...(body.truncated ? { truncated: true } : {}),
          };
        }),
      },
      count: versions.length,
    };
  },
};

export const AI_SETUP_TOOLS: readonly ToolDef[] = [
  getAiAgentSetup,
  getAiContextItem,
  tryAiReply,
  updateAiSetup,
  getAiSetupHistory,
] as ToolDef[];
