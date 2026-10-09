import type {
  AiDocumentView,
  AiTryResult,
  McpTryAiReplyInput,
  McpUpdateAiSetupInput,
} from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import type { ApiPrincipal } from '../api-tokens/index.js';
import { AI_TIMEZONE_SETTING, resolveAiTimeZone } from '../ai/prompt.js';
import { listSetupVersions, type SetupTarget, type SetupVersion } from '../ai/setup-versions.js';
import { localDate, localMidnight } from '../chats/stats.js';
import { WindowLimiter } from '../http/window-limiter.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AiAgentSetup {
  name: string | null;
  enabled: boolean;
  /** Connection state only (never the key or the account sign-in). */
  connection: string;
  instructions: string;
  handoffRules: string;
  businessContext: Array<{
    id: number;
    name: string;
    kind: 'file' | 'text';
    characters: number;
    updatedAt: number;
    /** Only text items can be changed over MCP. */
    editable: boolean;
  }>;
}

export interface AiStats {
  /** Hand-offs per reason (the codes the inbox shows as "handed this chat to the team: …"). */
  handoffsByReason: Record<string, number>;
  /** One row per local day, oldest first. */
  daily: Array<{
    date: string;
    handoffs: number;
    resolvedByAi: number;
    chatsAnswered: number;
    aiMessages: number;
  }>;
  totals: { handoffs: number; resolvedByAi: number; chatsAnswered: number; aiMessages: number };
}

/**
 * The AI Sales Agent's setup as MCP tools may use it: read, test, and change the instruction texts
 * and Business context text items. Never the connection, key, model or on/off switch.
 */
export interface AiSetupPort {
  setup(): AiAgentSetup;
  contextItem(id: number): AiDocumentView;
  stats(days: number): AiStats;
  tryReply(input: McpTryAiReplyInput): Promise<AiTryResult>;
  update(input: McpUpdateAiSetupInput, principal: ApiPrincipal): { versionId: number | null };
  history(target: SetupTarget, itemId: number | null, limit: number): SetupVersion[];
  /** Throws when a token makes too many changes (20 an hour) or test replies (10 a minute). */
  allow(kind: 'update' | 'try', tokenId: number): void;
}

export class AiSetupError extends Error {}

export function createAiSetupPort(ctx: AppContext): AiSetupPort {
  const ai = () => {
    const service = ctx.services.ai;
    if (!service) throw new AiSetupError('The AI Sales Agent is not available on this server');
    return service;
  };
  const timeZone = () => resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null));
  // Changes reach every customer; test replies spend the owner's AI connection.
  const limiters = {
    update: new WindowLimiter({ windowMs: 60 * 60_000, max: 20 }),
    try: new WindowLimiter({ windowMs: 60_000, max: 10 }),
  };

  return {
    setup() {
      const status = ai().status();
      return {
        name: status.member?.displayName ?? null,
        enabled: status.settings.enabled,
        connection: status.connection.state,
        instructions: status.settings.instructions,
        handoffRules: status.settings.handoffRules ?? '',
        businessContext: status.documents.map((d) => ({
          id: d.id,
          name: d.name,
          kind: d.kind,
          characters: d.characters,
          updatedAt: d.updatedAt,
          editable: d.kind === 'text',
        })),
      };
    },

    contextItem(id) {
      return ai().document(id);
    },

    stats(days) {
      const tz = timeZone();
      const startOfToday = localMidnight(localDate(Date.now(), tz), tz);
      let end = localMidnight(localDate(startOfToday + DAY_MS * 1.5, tz), tz);
      const aiUserId = ai().status().member?.id ?? null;
      const audits = ctx.db.prepare(
        'SELECT meta FROM audit_log WHERE action = ? AND at >= ? AND at < ?',
      );
      const answered = ctx.db.prepare(
        `SELECT COUNT(DISTINCT chat_jid) AS chats, COUNT(*) AS messages FROM messages
         WHERE sent_by_user_id = ? AND from_me = 1 AND timestamp >= ? AND timestamp < ?`,
      );
      const byReason: Record<string, number> = {};
      const daily: AiStats['daily'] = [];
      for (let i = 0; i < days; i++) {
        const date = localDate(end - DAY_MS / 2, tz);
        const start = localMidnight(date, tz);
        const handoffs = audits.all('ai.handoff', start, end) as Array<{ meta: string }>;
        for (const h of handoffs) {
          let reason = 'unknown';
          try {
            const parsed = JSON.parse(h.meta) as { reason?: unknown };
            if (typeof parsed.reason === 'string') reason = parsed.reason;
          } catch {
            // keep 'unknown'
          }
          byReason[reason] = (byReason[reason] ?? 0) + 1;
        }
        const resolved = (audits.all('ai.resolve', start, end) as unknown[]).length;
        const sent =
          aiUserId === null
            ? { chats: 0, messages: 0 }
            : (answered.get(aiUserId, start, end) as { chats: number; messages: number });
        daily.unshift({
          date,
          handoffs: handoffs.length,
          resolvedByAi: resolved,
          chatsAnswered: sent.chats,
          aiMessages: sent.messages,
        });
        end = start;
      }
      const sum = (key: 'handoffs' | 'resolvedByAi' | 'chatsAnswered' | 'aiMessages') =>
        daily.reduce((n, d) => n + d[key], 0);
      return {
        handoffsByReason: byReason,
        daily,
        totals: {
          handoffs: sum('handoffs'),
          resolvedByAi: sum('resolvedByAi'),
          chatsAnswered: sum('chatsAnswered'),
          aiMessages: sum('aiMessages'),
        },
      };
    },

    tryReply(input) {
      const current = ai().status().settings;
      return ai().tryAnswer({
        question: input.message,
        knowledge: {
          displayName: current.displayName,
          instructions: input.instructions ?? current.instructions,
          handoffRules: input.handoffRules ?? current.handoffRules ?? '',
        },
      });
    },

    update(input, principal) {
      const service = ai();
      const actor = {
        userId: principal.user.id,
        ip: null,
        via: 'mcp' as const,
        tokenId: principal.tokenId,
        reason: input.reason,
      };
      const latest = (target: SetupTarget, itemId: number | null) =>
        listSetupVersions(ctx.db, target, itemId, 1)[0]?.id ?? null;
      if (input.target === 'instructions' || input.target === 'handoff_rules') {
        if (input.itemId !== undefined || input.name !== undefined)
          throw new AiSetupError('itemId and name apply to context_text only');
        const current = service.status().settings;
        service.saveMember(
          {
            displayName: current.displayName,
            enabled: current.enabled,
            instructions: input.target === 'instructions' ? input.text : current.instructions,
            handoffRules:
              input.target === 'handoff_rules' ? input.text : (current.handoffRules ?? ''),
          },
          actor,
        );
        return { versionId: latest(input.target, null) };
      }
      if (input.itemId === undefined) {
        if (!input.name) throw new AiSetupError('Give a name to add a new text item');
        const before = new Set(service.status().documents.map((d) => d.id));
        const after = service.addText({ name: input.name, text: input.text }, actor);
        const added = after.documents.find((d) => !before.has(d.id));
        return { versionId: added ? latest('context_text', added.id) : null };
      }
      const item = service.status().documents.find((d) => d.id === input.itemId);
      if (!item) throw new AiSetupError(`No Business context item ${input.itemId}`);
      if (item.kind !== 'text')
        throw new AiSetupError('Uploaded files cannot be changed over MCP; only text items');
      service.updateText(
        input.itemId,
        { text: input.text, ...(input.name ? { name: input.name } : {}) },
        actor,
      );
      return { versionId: latest('context_text', input.itemId) };
    },

    history(target, itemId, limit) {
      return listSetupVersions(ctx.db, target, itemId, limit);
    },

    allow(kind, tokenId) {
      const hit = limiters[kind].hit(String(tokenId));
      if (!hit.allowed) {
        const what = kind === 'update' ? 'setup changes' : 'test replies';
        throw new AiSetupError(
          `Too many ${what} with this token; try again in ${hit.retryAfterSec} s`,
        );
      }
    },
  };
}
