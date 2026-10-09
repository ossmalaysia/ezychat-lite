import {
  McpGetAiAgentSetupInput,
  McpGetAiContextItemInput,
  McpGetAiSetupHistoryInput,
  McpGetAiSetupVersionInput,
  McpTryAiReplyInput,
  McpUpdateAiSetupInput,
} from '@wa-team-inbox/shared';
import { ToolError, type ToolDef } from './tools.js';

/** Characters per page of a long text (a full item or version is read page by page). */
const PAGE_CHARS = 20_000;
/** Preview of each version in get_ai_setup_history; get_ai_setup_version returns the full text. */
const PREVIEW_CHARS = 2_000;

const iso = (t: number) => new Date(t).toISOString();

/**
 * One page of a text, counted in characters (code points, so emoji and CJK never split). Every page
 * says whether more follows, so an assistant never mistakes a part for the whole.
 */
export function page(text: string, offset: number, size = PAGE_CHARS) {
  const chars = Array.from(text);
  const end = Math.min(chars.length, offset + size);
  return {
    text: chars.slice(offset, end).join(''),
    offset,
    totalCharacters: chars.length,
    nextOffset: end < chars.length ? end : null,
    // True on the final page (and when the whole text fits in one): nothing left to fetch.
    lastPage: end >= chars.length,
  };
}

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
    'The text of one Business context item (what the AI answers from), 20,000 characters per page: while nextOffset is not null, call again with offset = nextOffset and join the pages. Text items can be changed with update_ai_setup (send the complete joined text); uploaded files are read-only and show a preview only.',
  scope: 'ai:setup',
  input: McpGetAiContextItemInput,
  run(args, { aiSetup }) {
    const item = aiSetup.contextItem(args.id);
    return {
      result: {
        id: item.id,
        name: item.name,
        kind: item.kind,
        editable: item.kind === 'text',
        updatedAt: iso(item.updatedAt),
        ...page(item.text, args.offset),
        // Files show a preview of their extracted text; text items are always whole.
        ...(item.truncated ? { filePreviewOnly: true } : {}),
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
    'Saved versions of the AI instructions, hand-off rules or a Business context text item, newest first: who changed it (in the app or by an AI assistant over MCP), when, why, and a preview. Get the complete text of a version with get_ai_setup_version; to revert, send that complete text back with update_ai_setup.',
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
          const preview = page(v.content, 0, PREVIEW_CHARS);
          return {
            versionId: v.id,
            at: iso(v.createdAt),
            changedIn: changedIn(v.via),
            by: v.userId === null ? null : (names.get(v.userId) ?? `user ${v.userId}`),
            tokenId: v.tokenId,
            reason: v.reason,
            totalCharacters: preview.totalCharacters,
            preview: preview.text,
            ...(preview.lastPage ? {} : { previewOnly: true }),
          };
        }),
      },
      count: versions.length,
    };
  },
};

const getAiSetupVersion: ToolDef<typeof McpGetAiSetupVersionInput> = {
  name: 'get_ai_setup_version',
  title: 'Read one saved version',
  description:
    'The complete text of one saved version (versionId from get_ai_setup_history), 20,000 characters per page: while nextOffset is not null, call again with offset = nextOffset and join the pages. Send the joined text to update_ai_setup to restore it.',
  scope: 'ai:setup',
  input: McpGetAiSetupVersionInput,
  run(args, { aiSetup }) {
    const version = aiSetup.version(args.versionId);
    if (!version) throw new ToolError(`No saved version ${args.versionId}`);
    return {
      result: {
        versionId: version.id,
        target: version.target,
        itemId: version.itemId,
        at: iso(version.createdAt),
        changedIn: changedIn(version.via),
        reason: version.reason,
        ...page(version.content, args.offset),
      },
      count: 1,
    };
  },
};

function changedIn(via: string): string {
  return via === 'mcp' ? 'AI assistant (MCP)' : via === 'app' ? 'app' : 'original text';
}

export const AI_SETUP_TOOLS: readonly ToolDef[] = [
  getAiAgentSetup,
  getAiContextItem,
  tryAiReply,
  updateAiSetup,
  getAiSetupHistory,
  getAiSetupVersion,
] as ToolDef[];
