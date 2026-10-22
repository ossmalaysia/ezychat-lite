import {
  AI_HANDOFF_RULES_CHARACTERS,
  AI_INSTRUCTIONS_CHARACTERS,
  AiContextPatchBody,
  AiContextTextBody,
  codePointLength,
  type AiAgentPreset,
  type AiDocument,
  type AiDocumentView,
  type AiSettings,
  type AiTryResult,
  type McpTryAiReplyInput,
  type McpUpdateAiSetupInput,
} from '@ezychat/shared';
import type { z } from 'zod';
import type { AppContext } from '../context.js';
import type { ApiPrincipal } from '../api-tokens/index.js';
import { AI_TIMEZONE_SETTING, resolveAiTimeZone } from '../ai/prompt.js';
import {
  getSetupVersion,
  listSetupVersions,
  type SetupTarget,
  type SetupVersion,
} from '../ai/setup-versions.js';
import { agentById, defaultAgent, type AgentRow } from '../ai/agents.js';
import { localDate, localMidnight } from '../chats/stats.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { inboxOfKey } from '../inboxes/keys.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AiAgentSetup {
  /** null = no agent is set up yet (the defaults are shown). */
  agentId: number | null;
  name: string | null;
  preset: AiAgentPreset;
  /** The inbox this agent answers; null = none. */
  inboxId: number | null;
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
    /** Internal: used by the agent to decide, never told to customers. */
    internal: boolean;
    /** Only text items can be changed over MCP. */
    editable: boolean;
  }>;
}

export interface AiAgentListItem {
  id: number;
  name: string;
  preset: AiAgentPreset;
  inboxId: number | null;
  enabled: boolean;
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
 * The AI agents' setup as MCP tools may use it: read, test, and change the instruction texts
 * and Business context text items. Never the connection, key, model or on/off switch.
 * `agentId` omitted = the only agent, else the agent of inbox 1 (old clients name none); an
 * unknown id throws `agent_not_found`.
 */
export interface AiSetupPort {
  agents(): AiAgentListItem[];
  setup(agentId?: number): AiAgentSetup;
  contextItem(id: number, agentId?: number): AiDocumentView;
  /** `inboxIds` counts the chats of those inboxes only; omitted = every inbox. */
  stats(days: number, inboxIds?: readonly number[]): AiStats;
  tryReply(input: McpTryAiReplyInput): Promise<AiTryResult>;
  update(input: McpUpdateAiSetupInput, principal: ApiPrincipal): { versionId: number | null };
  history(
    target: SetupTarget,
    itemId: number | null,
    limit: number,
    agentId?: number,
  ): SetupVersion[];
  version(id: number): SetupVersion | null;
  /** Throws when a token makes too many changes (20 an hour) or test replies (10 a minute). */
  allow(kind: 'update' | 'try', tokenId: number): void;
}

export class AiSetupError extends Error {}

export function createAiSetupPort(ctx: AppContext): AiSetupPort {
  const ai = () => {
    const service = ctx.services.ai;
    if (!service) throw new AiSetupError('The AI agents are not available on this server');
    return service;
  };
  const timeZone = () => resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null));
  // Changes reach every customer; test replies spend the owner's AI connection.
  const limiters = {
    update: new WindowLimiter({ windowMs: 60 * 60_000, max: 20 }),
    try: new WindowLimiter({ windowMs: 60_000, max: 10 }),
  };
  /** The named agent, else the default one (null while none is set up). */
  const agentOf = (agentId: number | undefined): AgentRow | null => {
    if (agentId === undefined) return defaultAgent(ctx.db);
    const agent = agentById(ctx.db, agentId);
    if (!agent)
      throw new AiSetupError(
        `agent_not_found: there is no AI agent ${agentId}; see list_ai_agents`,
      );
    return agent;
  };
  /** Effective settings and items of an agent; no agent yet = the defaults. */
  const current = (agent: AgentRow | null): { settings: AiSettings; documents: AiDocument[] } => {
    if (agent) return ai().agentStatus(agent.id);
    const status = ai().status();
    return { settings: status.settings, documents: status.documents };
  };

  return {
    agents() {
      return ai()
        .listAgents()
        .map((a) => ({
          id: a.id,
          name: a.displayName,
          preset: a.preset,
          inboxId: a.inboxId,
          enabled: a.enabled,
        }));
    },

    setup(agentId) {
      const agent = agentOf(agentId);
      const { settings, documents } = current(agent);
      return {
        agentId: agent?.id ?? null,
        name: agent?.displayName ?? null,
        preset: agent?.preset ?? 'sales',
        inboxId: agent?.inboxId ?? null,
        enabled: settings.enabled,
        connection: ai().status().connection.state,
        instructions: settings.instructions,
        handoffRules: settings.handoffRules ?? '',
        businessContext: documents.map((d) => ({
          id: d.id,
          name: d.name,
          kind: d.kind,
          characters: d.characters,
          updatedAt: d.updatedAt,
          internal: d.internal,
          editable: d.kind === 'text',
        })),
      };
    },

    contextItem(id, agentId) {
      return ai().document(agentOf(agentId)?.id ?? null, id);
    },

    stats(days, inboxIds) {
      const tz = timeZone();
      const startOfToday = localMidnight(localDate(Date.now(), tz), tz);
      let end = localMidnight(localDate(startOfToday + DAY_MS * 1.5, tz), tz);
      const audits = ctx.db.prepare(
        'SELECT meta FROM audit_log WHERE action = ? AND at >= ? AND at < ?',
      );
      const only = inboxIds ? new Set(inboxIds) : null;
      // An audit row names its chat by key; the key carries the inbox.
      const inInboxes = (meta: string) => {
        if (!only) return true;
        try {
          const chatJid = (JSON.parse(meta) as { chatJid?: unknown }).chatJid;
          return typeof chatJid === 'string' && only.has(inboxOfKey(chatJid));
        } catch {
          return false;
        }
      };
      // Every AI agent's replies (a deleted agent's past replies still count).
      const answered = ctx.db.prepare(
        `SELECT COUNT(DISTINCT chat_jid) AS chats, COUNT(*) AS messages FROM messages
         WHERE sent_by_user_id IN (SELECT id FROM users WHERE kind = 'ai')
           AND from_me = 1 AND timestamp >= ? AND timestamp < ?
           AND (? IS NULL OR chat_jid IN (SELECT jid FROM chats
                WHERE inbox_id IN (SELECT value FROM json_each(?))))`,
      );
      const inboxJson = inboxIds ? JSON.stringify(inboxIds) : null;
      const byReason: Record<string, number> = {};
      const daily: AiStats['daily'] = [];
      for (let i = 0; i < days; i++) {
        const date = localDate(end - DAY_MS / 2, tz);
        const start = localMidnight(date, tz);
        const handoffs = (audits.all('ai.handoff', start, end) as Array<{ meta: string }>).filter(
          (h) => inInboxes(h.meta),
        );
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
        const resolved = (audits.all('ai.resolve', start, end) as Array<{ meta: string }>).filter(
          (r) => inInboxes(r.meta),
        ).length;
        const sent = answered.get(start, end, inboxJson, inboxJson) as {
          chats: number;
          messages: number;
        };
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
      const agent = agentOf(input.agentId);
      const { settings } = current(agent);
      return ai().tryAnswer({
        question: input.message,
        knowledge: {
          displayName: settings.displayName,
          instructions: input.instructions ?? settings.instructions,
          handoffRules: input.handoffRules ?? settings.handoffRules ?? '',
        },
        ...(agent ? { agentId: agent.id } : {}),
      });
    },

    update(input, principal) {
      const service = ai();
      const agent = agentOf(input.agentId);
      // Same limits as the app's forms: the service methods trust their callers.
      const within = (max: number, label: string) => {
        if (codePointLength(input.text) > max)
          throw new AiSetupError(`${label} can be at most ${max.toLocaleString('en')} characters`);
      };
      const check = <T extends z.ZodTypeAny>(schema: T, value: unknown) => {
        const parsed = schema.safeParse(value);
        if (!parsed.success)
          throw new AiSetupError(parsed.error.issues.map((i) => i.message).join('; '));
      };
      const internal = input.internal !== undefined ? { internal: input.internal } : {};
      if (input.target === 'instructions') within(AI_INSTRUCTIONS_CHARACTERS, 'AI instructions');
      if (input.target === 'handoff_rules') within(AI_HANDOFF_RULES_CHARACTERS, 'Hand-off rules');
      if (input.target === 'context_text')
        check(
          input.itemId === undefined ? AiContextTextBody : AiContextPatchBody,
          input.itemId === undefined
            ? { name: input.name, text: input.text, ...internal }
            : { text: input.text, ...(input.name ? { name: input.name } : {}), ...internal },
        );
      const actor = {
        userId: principal.user.id,
        ip: null,
        via: 'mcp' as const,
        tokenId: principal.tokenId,
        reason: input.reason,
      };
      // The version just saved, in the history of the agent that was changed.
      const latest = (agentId: number, target: SetupTarget, itemId: number | null) =>
        listSetupVersions(ctx.db, agentId, target, itemId, 1)[0]?.id ?? null;
      if (input.target === 'instructions' || input.target === 'handoff_rules') {
        if (input.itemId !== undefined || input.name !== undefined || input.internal !== undefined)
          throw new AiSetupError('itemId, name and internal apply to context_text only');
        const { settings } = current(agent);
        const body = {
          displayName: settings.displayName,
          enabled: settings.enabled,
          instructions: input.target === 'instructions' ? input.text : settings.instructions,
          handoffRules:
            input.target === 'handoff_rules' ? input.text : (settings.handoffRules ?? ''),
        };
        // No agent yet: the old save creates the inbox-1 agent.
        if (agent) service.saveAgent(agent.id, body, actor);
        else service.saveMember(body, actor);
        const saved = agent ?? defaultAgent(ctx.db);
        return { versionId: saved ? latest(saved.id, input.target, null) : null };
      }
      if (input.itemId === undefined) {
        if (!input.name) throw new AiSetupError('Give a name to add a new text item');
        const before = new Set(current(agent).documents.map((d) => d.id));
        const after = service.addText(
          agent?.id ?? null,
          { name: input.name, text: input.text, ...internal },
          actor,
        );
        const added = after.documents.find((d) => !before.has(d.id));
        return { versionId: added ? latest(after.agent.id, 'context_text', added.id) : null };
      }
      const item = current(agent).documents.find((d) => d.id === input.itemId);
      if (!agent || !item) throw new AiSetupError(`No Business context item ${input.itemId}`);
      if (item.kind !== 'text')
        throw new AiSetupError('Uploaded files cannot be changed over MCP; only text items');
      service.updateText(
        agent.id,
        input.itemId,
        { text: input.text, ...(input.name ? { name: input.name } : {}), ...internal },
        actor,
      );
      return { versionId: latest(agent.id, 'context_text', input.itemId) };
    },

    history(target, itemId, limit, agentId) {
      const agent = agentOf(agentId);
      return agent ? listSetupVersions(ctx.db, agent.id, target, itemId, limit) : [];
    },

    version(id) {
      return getSetupVersion(ctx.db, id);
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
