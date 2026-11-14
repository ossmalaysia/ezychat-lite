import { randomUUID } from 'node:crypto';
import {
  AI_INSTRUCTIONS_CHARACTERS,
  AiAgentBody,
  SCHEDULED_TASKS_MAX,
  ScheduledTaskBody,
  ScheduledTaskPatch,
  presetTexts,
  type AiAgentPreset,
  type AskEzyChangeResult,
  type AskEzyChangeStatus,
  type AskEzyTaskBefore,
  type Chat,
  type ScheduledDayRule,
  type User,
} from '@ezychat/shared';
import type { AppContext } from '../context.js';
import { HttpError } from '../http/errors.js';
import { agentById, listAgents, type AgentRow } from '../ai/agents.js';
import { AI_TIMEZONE_SETTING, resolveAiTimeZone } from '../ai/prompt.js';
import { setAgentDirect } from '../ai/groups.js';
import { canOpenChat } from '../inboxes/access.js';
import { replyWindowOpen } from '../inboxes/reply-window.js';
import { ScheduledRepo, type TaskRow } from '../scheduled/repo.js';
import { toTime } from '../scheduled/time.js';
import { getChats } from '../wa-bridge/index.js';
import { CHANGE_TTL_MS, CHANGES_PER_USER, ProposeError } from './changes.js';

/**
 * Ask Ezy sets up agents and scheduled tasks (design docs/features/ask-ezy-setup/design.md). Like a setup change
 * (`changes.ts`), a proposal is held in memory per admin (30 minutes, 20 per admin, server-made ids) and writes
 * nothing until the admin presses Apply; Apply goes through the normal services (agent create, scheduled-task
 * create/update) with their limits and errors. Logs carry ids, kinds and outcomes only.
 */

interface TaskSpec {
  name: string;
  time: string;
  dayRule: ScheduledDayRule;
  days: number[];
  chatJid: string;
  instruction: string;
}

interface ChatInfo {
  /** null: the chat has no name but its number (shown as "Chat …6789", never the whole number). */
  name: string | null;
  ending: string | null;
  type: 'dm' | 'group';
}

interface Base {
  id: string;
  userId: number;
  status: AskEzyChangeStatus;
  createdAt: number;
}

export interface AgentProposal extends Base {
  kind: 'agent';
  name: string;
  preset: AiAgentPreset;
  inboxId: number;
  inboxName: string;
  instructions: string | null;
  note: string | null;
  /** The created agent (applied). */
  agentId?: number;
  /** The agent's setup right after Apply: Undo refuses once the admin changed anything of it. */
  snapshot?: string;
}

export interface TaskProposal extends Base {
  kind: 'task';
  /** The agent; null while it is the pending new agent `dependsOn`. */
  agentId: number | null;
  dependsOn: string | null;
  agentName: string;
  spec: TaskSpec;
  chat: ChatInfo;
  timeZone: string;
  preview: string | null;
  /** The preview took longer than its budget: left out, the card still shows. */
  previewTimedOut?: boolean;
  /** An edit of an existing task: the fields it changes, their saved values and the saved row's time. */
  edit: {
    taskId: number;
    updatedAt: number;
    patch: Partial<TaskSpec>;
    original: Partial<TaskSpec>;
    before: AskEzyTaskBefore;
  } | null;
  taskId?: number;
  /** Apply created the agent `dependsOn` in the same request (Undo removes both). */
  createdAgent?: boolean;
  /** The task's `updated_at` right after Apply (Undo refuses when someone saved it since). */
  appliedAt?: number;
}

export type SetupProposal = AgentProposal | TaskProposal;

export interface ProposeAgentInput {
  name: string;
  inboxId?: number;
  /** Extra detail added after the role text (never replaces it). */
  instructions?: string;
  /** What it sends, to whom and when: the server writes the agent's role text from it. */
  purpose: string;
}

/** Names that say nothing about the agent ("New AI agent", "Assistant 2"): Ezy names it from its purpose. */
const GENERIC_NAME =
  /^(?:(?:my|the|a|new|another)\s+)*(?:ai\s+|whatsapp\s+)?(?:agent|assistant|bot|helper|ai|member)(?:\s*\d+)?$/i;

/**
 * A new agent's role text, written by the server from its purpose (owner decision 2026-11-12): it sends the
 * scheduled messages its tasks ask for and never answers chats. The same LANGUAGE and STYLE rules as the presets.
 */
export function scheduledAgentInstructions(purpose: string, extra?: string): string {
  const lines = [
    'ROLE',
    `You send this business's scheduled WhatsApp messages. ${purpose.trim()}`,
    'You send only what your scheduled tasks ask for, at their times. You do not answer chats: our team does.',
    '',
    'CONTENT',
    "- Follow the task's instruction. Use only facts from the business context, the chat and the task.",
    '- Never invent prices, dates, offers or promises. When the task needs a fact you do not have, send nothing.',
    '',
    'LANGUAGE',
    "- Write in the language of the chat. If the chat has no messages yet, use the task's language.",
    '- If you cannot write in that language, use the default language named in the business context, otherwise English.',
    '',
    'STYLE',
    '- Warm, natural and short: one or two sentences unless the task asks for more. At most one emoji, only where it fits.',
    '- WhatsApp formatting only: *bold* for key details and plain line breaks. No headings, tables or links you were not given.',
  ];
  if (extra?.trim()) lines.push('', 'MORE', extra.trim());
  return lines.join('\n');
}

export interface ProposeTaskInput {
  agentId?: number;
  agentProposalId?: string;
  chatJid: string;
  name: string;
  time: string;
  dayRule: ScheduledDayRule;
  days?: number[];
  instruction: string;
}

export interface ProposeTaskEditInput {
  taskId: number;
  name?: string;
  time?: string;
  dayRule?: ScheduledDayRule;
  days?: number[];
  chatJid?: string;
  instruction?: string;
}

/** The last 4 digits of a direct chat's number (shown to tell two same-named chats apart). */
export function chatEnding(chat: Pick<Chat, 'type' | 'phone' | 'waJid'>): string | null {
  if (chat.type === 'group') return null;
  const number =
    chat.phone ?? (chat.waJid.endsWith('@s.whatsapp.net') ? chat.waJid.split('@')[0]! : '');
  const digits = number.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

const FIELDS = ['name', 'time', 'dayRule', 'days', 'chatJid', 'instruction'] as const;
const NO_NUMBER = 'This agent serves no WhatsApp number, so it cannot send scheduled messages';
/** Ask Ezy's own proposal previews per admin per minute (the agent page's preview limit is separate). */
export const ASK_EZY_PREVIEWS_PER_MINUTE = 10;
/** A proposal's preview gets this long; then the card comes without it (the Ask Ezy turn must not time out). */
export const ASK_EZY_PREVIEW_TIMEOUT_MS = 20_000;

/** A name that is only a phone number ("60123456789", "+60 12-345 6789") is no name. */
const isNumber = (text: string) =>
  /^[\d\s+().-]+$/.test(text) && text.replace(/\D/g, '').length >= 5;
/** What the model and logs-free cards call a chat without a name: never its whole number. */
export const chatLabel = (chat: { name: string | null; ending: string | null }) =>
  chat.name ?? (chat.ending ? `Chat …${chat.ending}` : 'Chat');
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const firstIssue = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }) =>
  error.issues
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');

export function createSetupStore(
  ctx: AppContext,
  now: () => number = Date.now,
  opts: { previewTimeoutMs?: number } = {},
) {
  const previewTimeoutMs = opts.previewTimeoutMs ?? ASK_EZY_PREVIEW_TIMEOUT_MS;
  const proposals = new Map<string, SetupProposal>();
  const repo = new ScheduledRepo(ctx.db);
  const chats = getChats(ctx);
  const log = ctx.log.child({ mod: 'ask-ezy' });

  const ai = () => {
    const service = ctx.services.ai;
    if (!service) throw new HttpError(503, 'ai_unavailable', 'The AI service is not running');
    return service;
  };
  const scheduled = () => {
    const service = ctx.services.scheduled;
    if (!service)
      throw new HttpError(503, 'ai_unavailable', 'Scheduled tasks are not available now');
    return service;
  };
  const timeZone = () => resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null));
  const inboxName = (id: number) => ctx.inboxes.repo.get(id)?.name ?? `inbox ${id}`;
  const actor = (user: User, ip: string | null, why: string) => ({
    userId: user.id,
    ip,
    via: 'app' as const,
    reason: `Ask Ezy: ${why}`,
  });

  const prune = () => {
    for (const [id, p] of proposals) if (now() - p.createdAt > CHANGE_TTL_MS) proposals.delete(id);
  };
  /** Removes a proposal and the task proposals that need it (a pair goes together). */
  const evict = (id: string) => {
    proposals.delete(id);
    for (const [key, x] of proposals)
      if (x.kind === 'task' && x.dependsOn === id) proposals.delete(key);
  };
  const keep = <T extends SetupProposal>(user: User, p: T): T => {
    prune();
    // The oldest go first, never the new agent the new proposal needs.
    const needs = p.kind === 'task' ? p.dependsOn : null;
    const mine = () =>
      [...proposals.values()].filter((x) => x.userId === user.id && x.id !== needs);
    for (let left = mine(); left.length + (needs ? 1 : 0) >= CHANGES_PER_USER; left = mine())
      evict(left[0]!.id);
    proposals.set(p.id, p);
    return p;
  };
  const own = (id: string, user: User): SetupProposal => {
    prune();
    const p = proposals.get(id);
    if (!p || p.userId !== user.id)
      throw new HttpError(404, 'change_not_found', 'This suggestion expired. Ask Ezy again.');
    return p;
  };
  const logApply = (p: SetupProposal, action: string, ok: boolean, code?: string) =>
    log.info(
      {
        event: 'ask_ezy_setup',
        kind: p.kind === 'task' && p.edit ? 'task_edit' : p.kind,
        action,
        ok,
        ...(code ? { code } : {}),
        agentId: p.kind === 'agent' ? (p.agentId ?? null) : p.agentId,
        ...(p.kind === 'task' ? { taskId: p.taskId ?? p.edit?.taskId ?? null } : {}),
      },
      'Ask Ezy setup proposal',
    );

  /** The agent's inbox for a task: an existing agent or a pending new-agent proposal of this admin. */
  const agentFor = (user: User, input: { agentId?: number; agentProposalId?: string }) => {
    if ((input.agentId === undefined) === (input.agentProposalId === undefined))
      throw new ProposeError('Give either agentId (an existing agent) or agentProposalId');
    if (input.agentId !== undefined) {
      const agent = agentById(ctx.db, input.agentId);
      if (!agent) throw new ProposeError('Unknown agentId: call list_ai_agents first');
      if (agent.inboxId === null) throw new ProposeError(NO_NUMBER);
      return {
        agentId: agent.id,
        dependsOn: null,
        inboxId: agent.inboxId,
        name: displayName(agent),
        draft: null,
      };
    }
    prune();
    const pending = proposals.get(input.agentProposalId!);
    if (!pending || pending.userId !== user.id || pending.kind !== 'agent')
      throw new ProposeError('Unknown agentProposalId: call propose_agent first');
    if (pending.status === 'applied' && pending.agentId)
      return agentFor(user, { agentId: pending.agentId });
    if (pending.status !== 'proposed')
      throw new ProposeError('That new agent was discarded: propose it again first');
    return {
      agentId: null,
      dependsOn: pending.id,
      inboxId: pending.inboxId,
      name: pending.name,
      draft: pending,
    };
  };

  const displayName = (agent: AgentRow) =>
    ctx.services.auth?.getUser(agent.userId)?.displayName ?? `AI agent ${agent.id}`;

  /** A chat the admin may open, that a look-up returned in this answer, on the agent's number. */
  const chatFor = (user: User, jid: string, seen: ReadonlySet<string>, agentInbox: number) => {
    if (!seen.has(jid))
      throw new ProposeError(
        'Use a chat id that list_chats or list_scheduled_tasks returned in this answer: look the chat up first',
      );
    const chat = chats.get(jid);
    if (!chat || !canOpenChat(ctx, user, { jid: chat.jid, inbox_id: chat.inboxId }))
      throw new ProposeError(`No chat found for ${jid}`);
    const inbox = ctx.inboxes.repo.get(chat.inboxId);
    if (!inbox || inbox.removed_at !== null)
      throw new ProposeError('That chat belongs to a removed WhatsApp number');
    if (chat.inboxId !== agentInbox)
      throw new ProposeError(
        `chat_not_in_inbox: ${JSON.stringify(chatLabel(infoOf(chat)))} is on another WhatsApp number (${inbox.name}); ` +
          `this agent sends only on ${inboxName(agentInbox)}. Nothing was proposed. Say so in a question ` +
          `block (tone "error") and ask what to use instead (an agent of ${inbox.name}, or another chat).`,
      );
    return chat;
  };
  /** The saved or WhatsApp name; never a phone number (the card writes "Chat …6789" then). */
  const infoOf = (chat: Chat): ChatInfo => ({
    name:
      [chat.name, chat.whatsappName]
        .map((n) => n?.trim() ?? '')
        .find((n) => n !== '' && !isNumber(n)) ?? null,
    ending: chatEnding(chat),
    type: chat.type === 'group' ? 'group' : 'dm',
  });

  const previewTimes = new Map<number, number[]>();
  /**
   * One message the agent would send now (nothing sent or stored); null when there is none. A new agent that is
   * not saved yet previews as a draft: its name, preset and instructions, no business context, no look-ups.
   * Its own limit (`ASK_EZY_PREVIEWS_PER_MINUTE`), not the agent page's; stops with the Ask Ezy request.
   */
  const preview = async (
    user: User,
    agent: { agentId: number } | { draft: AgentProposal },
    chat: { jid: string; taskName: string; instruction: string },
    signal?: AbortSignal,
  ): Promise<{ text: string | null; timedOut: boolean }> => {
    const none = { text: null, timedOut: false };
    const at = now();
    const recent = (previewTimes.get(user.id) ?? []).filter((t) => at - t < 60_000);
    if (recent.length >= ASK_EZY_PREVIEWS_PER_MINUTE) return none;
    previewTimes.set(user.id, [...recent, at]);
    const service = ai();
    if (!service.answerReady() || !replyWindowOpen(ctx, chat.jid, at)) return none;
    // Its own short budget: a slow preview leaves the card without one, never the turn without a card.
    const budget = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      budget.abort();
    }, previewTimeoutMs);
    const stopped = new Promise<null>((resolve) =>
      budget.signal.addEventListener('abort', () => resolve(null), { once: true }),
    );
    try {
      const turn = await Promise.race([
        stopped,
        service.scheduledTurn(
          {
            agentId: 'agentId' in agent ? agent.agentId : null,
            chatJid: chat.jid,
            task: { name: chat.taskName, instruction: chat.instruction },
            preview: true,
            ...('draft' in agent
              ? {
                  draft: {
                    name: agent.draft.name,
                    preset: agent.draft.preset,
                    instructions: agent.draft.instructions,
                  },
                }
              : {}),
          },
          AbortSignal.any([...(signal ? [signal] : []), budget.signal]),
        ),
      ]);
      if (!turn) return { text: null, timedOut };
      return { text: turn.outcome === 'send' && turn.text ? turn.text : null, timedOut: false };
    } catch {
      return { text: null, timedOut };
    } finally {
      clearTimeout(timer);
      budget.abort();
    }
  };

  const previewFields = async (...args: Parameters<typeof preview>) => {
    const { text, timedOut } = await preview(...args);
    return { preview: text, ...(timedOut ? { previewTimedOut: true } : {}) };
  };

  /** What to tell the person at the agent limit: Lite's own sentence, else the real limit. */
  const limitText = (max: number) => {
    const sentence =
      ctx.edition === 'lite' && max === 1
        ? "EzyChat Lite has one AI agent, so I can't add a new one."
        : `This EzyChat allows ${max} AI agent${max === 1 ? '' : 's'} and all are in use, so I can't add a new one.`;
    return (
      `agent_limit: no room for a new AI agent. Tell the person, in their language: "${sentence}" ` +
      'Say it in a question block note (tone "warning") and offer an existing agent instead.'
    );
  };

  const agentRow = (p: AgentProposal) => (p.agentId ? agentById(ctx.db, p.agentId) : null);
  const agentInUse = (agent: AgentRow) =>
    agent.enabled ||
    repo.count(agent.id) > 0 ||
    !!ctx.db.prepare('SELECT 1 FROM chats WHERE assigned_to = ? LIMIT 1').get(agent.userId);
  /** Only an edition with room for more than one agent deletes one (Lite keeps its only agent). */
  const removable = () => ai().maxAgents() > 1;

  /**
   * Everything an admin can change of an agent: its name, switches, texts, items, and every row keyed by the
   * agent (setup versions, group chats, connector settings…). Scheduled tasks are checked on their own, and
   * the phrase list is built by the app, not the admin.
   */
  const agentTables = () =>
    (
      ctx.db
        .prepare(
          "SELECT DISTINCT m.name AS name FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type = 'table' AND p.name = 'agent_id'",
        )
        .all() as Array<{ name: string }>
    )
      .map((r) => r.name)
      .filter((name) => !name.startsWith('ai_scheduled') && !name.startsWith('reply_phrase'));
  const fingerprint = (agentId: number) => {
    const status = ai().agentStatus(agentId);
    const rows = agentTables().map((table) => [
      table,
      (
        ctx.db.prepare(`SELECT count(*) AS n FROM "${table}" WHERE agent_id = ?`).get(agentId) as {
          n: number;
        }
      ).n,
    ]);
    return JSON.stringify({
      agent: status.agent,
      instructions: status.settings.instructions,
      handoffRules: status.settings.handoffRules,
      documents: status.documents.map((d) => [d.id, d.name]),
      rows,
    });
  };

  const applyAgent = (p: AgentProposal, user: User, ip: string | null) => {
    if (p.status === 'applied' && p.agentId) {
      // A retry after "Apply both" made only the agent: it must still be there.
      if (!agentRow(p))
        throw new HttpError(409, 'agent_gone', 'The new agent was removed. Ask Ezy again.');
      return p.agentId;
    }
    try {
      const who = actor(user, ip, 'new agent');
      const status = ai().createAgent(
        {
          displayName: p.name,
          enabled: false,
          preset: p.preset,
          instructions: p.instructions ?? presetTexts(p.preset).instructions,
          inboxId: p.inboxId,
        },
        who,
      );
      // It sends scheduled messages only: it never answers direct chats.
      if (status.agent.answerDirect) setAgentDirect(ctx, status.agent.id, false, who);
      p.agentId = status.agent.id;
      p.status = 'applied';
      p.snapshot = fingerprint(p.agentId);
      logApply(p, 'apply', true);
      return p.agentId;
    } catch (error) {
      logApply(p, 'apply', false, error instanceof HttpError ? error.code : 'error');
      throw error;
    }
  };

  /**
   * Removes the agent Apply created: only where an agent can be deleted (not Lite), while it is off, has no
   * chats or scheduled tasks, and nothing of it changed since Apply. Task proposals that still wait for it
   * (other than `except`) are discarded; returns them.
   */
  const undoAgent = (p: AgentProposal, user: User, ip: string | null, except?: string) => {
    const agent = agentRow(p);
    if (agent) {
      if (!removable())
        throw new HttpError(
          409,
          'agent_kept',
          'This edition keeps its only AI agent: it stays, switched off. Change it on its page.',
        );
      if (agentInUse(agent))
        throw new HttpError(
          409,
          'agent_in_use',
          'The agent is on, or has chats or scheduled tasks: change it on its page',
        );
      if (p.snapshot !== undefined && fingerprint(agent.id) !== p.snapshot)
        throw new HttpError(
          409,
          'setup_changed',
          'The agent changed after it was created: change or remove it on its page',
        );
      ai().deleteAgent(agent.id, actor(user, ip, 'undo new agent'));
    }
    const gone = p.agentId;
    p.status = 'proposed';
    p.agentId = undefined;
    p.snapshot = undefined;
    logApply(p, 'undo', true);
    const discarded: NonNullable<AskEzyChangeResult['related']> = [];
    for (const x of proposals.values())
      if (
        x.kind === 'task' &&
        x.id !== except &&
        x.status === 'proposed' &&
        (x.dependsOn === p.id || (gone !== undefined && x.agentId === gone))
      ) {
        x.status = 'discarded';
        if (x.dependsOn === p.id) x.agentId = null;
        discarded.push({ id: x.id, status: 'discarded' });
      }
    return discarded;
  };

  const taskResult = (p: TaskProposal, related: AskEzyChangeResult['related']) => {
    const agentId = p.agentId!;
    const task = scheduled()
      .list(agentId)
      .tasks.find((x) => x.id === p.taskId);
    return {
      status: p.status,
      related,
      agentId,
      ...(p.taskId ? { taskId: p.taskId } : {}),
      nextRunAt: task?.nextRunAt ?? null,
      agentOn: agentById(ctx.db, agentId)?.enabled ?? false,
    } satisfies AskEzyChangeResult;
  };

  const applyTask = (p: TaskProposal, user: User, ip: string | null): AskEzyChangeResult => {
    if (p.status === 'applied') return taskResult(p, []);
    let dep: AgentProposal | null = null;
    if (p.agentId === null) {
      const found = own(p.dependsOn!, user);
      if (found.kind !== 'agent') throw new HttpError(404, 'change_not_found', 'Not found');
      dep = found;
      if (dep.status === 'discarded')
        throw new HttpError(409, 'agent_discarded', 'Apply the new agent first');
      const created = dep.status !== 'applied';
      // The new agent first: when it is refused (agent_limit), nothing is created.
      p.agentId = applyAgent(dep, user, ip);
      p.createdAgent = created;
    }
    const agentId = p.agentId;
    const related = dep && p.createdAgent ? [{ id: dep.id, status: dep.status }] : [];
    try {
      const who = actor(user, ip, 'scheduled task');
      if (p.edit) {
        const saved = repo.get(p.edit.taskId);
        if (!saved || saved.agentId !== agentId || saved.updatedAt !== p.edit.updatedAt)
          throw new HttpError(409, 'setup_changed', 'The task changed since Ezy read it');
        scheduled().update(agentId, p.edit.taskId, ScheduledTaskPatch.parse(p.edit.patch), who);
        p.taskId = p.edit.taskId;
      } else {
        p.taskId = scheduled().create(agentId, ScheduledTaskBody.parse(p.spec), who).id;
      }
    } catch (error) {
      logApply(p, 'apply', false, error instanceof HttpError ? error.code : 'error');
      // The task waits for its new agent again: a retry reads (and re-checks) the agent proposal.
      if (dep) {
        p.agentId = null;
        p.createdAgent = false;
      }
      // "Apply both": the agent stays (it is off, with its own Undo); the task was not saved, and the card says why.
      if (related.length && error instanceof HttpError)
        return {
          status: 'proposed',
          related,
          agentId,
          failed: { code: error.code, message: error.message.slice(0, 500) },
        };
      throw error;
    }
    p.status = 'applied';
    p.appliedAt = repo.get(p.taskId)?.updatedAt;
    logApply(p, 'apply', true);
    return taskResult(p, related);
  };

  const undoTask = (p: TaskProposal, user: User, ip: string | null): AskEzyChangeResult => {
    const agentId = p.agentId!;
    const who = actor(user, ip, 'undo scheduled task');
    const saved = p.taskId ? repo.get(p.taskId) : null;
    if (p.edit) {
      if (!saved || saved.updatedAt !== p.appliedAt)
        throw new HttpError(409, 'setup_changed', 'The task changed after the change was applied');
      scheduled().update(agentId, p.edit.taskId, ScheduledTaskPatch.parse(p.edit.original), who);
      p.edit.updatedAt = repo.get(p.edit.taskId)!.updatedAt;
    } else if (saved) {
      // Changed on the agent page since Apply: never remove what someone edited.
      if (saved.updatedAt !== p.appliedAt)
        throw new HttpError(409, 'setup_changed', 'The task changed after it was saved');
      scheduled().remove(agentId, saved.id, who);
    }
    p.status = 'proposed';
    if (!p.edit) p.taskId = undefined;
    logApply(p, 'undo', true);
    const related: AskEzyChangeResult['related'] = [];
    if (p.createdAgent && p.dependsOn) {
      const dep = proposals.get(p.dependsOn);
      if (dep?.kind === 'agent' && dep.status === 'applied') {
        try {
          related.push(...undoAgent(dep, user, ip, p.id));
          p.agentId = null;
        } catch {
          // Lite keeps its only agent, or the agent is in use now: it stays (off), the task is gone.
        }
        p.createdAgent = false;
        related.unshift({ id: dep.id, status: dep.status });
      }
    }
    return { status: p.status, related, ...(p.agentId ? { agentId: p.agentId } : {}) };
  };

  const taskProposal = (
    user: User,
    fields: Omit<TaskProposal, 'id' | 'userId' | 'status' | 'createdAt' | 'kind' | 'timeZone'>,
  ): TaskProposal =>
    keep(user, {
      kind: 'task',
      id: randomUUID(),
      userId: user.id,
      status: 'proposed',
      createdAt: now(),
      timeZone: timeZone(),
      ...fields,
    });

  const specOf = (task: TaskRow): TaskSpec => ({
    name: task.name,
    time: toTime(task.timeMinutes),
    dayRule: task.dayRule,
    days: task.dayRule === 'custom' ? task.days : [],
    chatJid: task.chatJid,
    instruction: task.instruction,
  });

  return {
    /** Records a new agent for the admin's Apply (refused at the edition's agent limit). */
    proposeAgent(user: User, input: ProposeAgentInput): AgentProposal {
      const service = ai();
      const max = service.maxAgents();
      if (listAgents(ctx.db).length >= max) throw new ProposeError(limitText(max));
      const name = AiAgentBody.shape.displayName.safeParse(input.name);
      const nameHelp =
        'Name it from what it does, e.g. "Morning greeter" for a morning greeting: never a generic name like "New AI agent" or "Assistant", nor the name of an existing agent.';
      if (!name.success) throw new ProposeError(`name: ${firstIssue(name.error)}. ${nameHelp}`);
      const taken = listAgents(ctx.db).some(
        (a) => displayName(a).trim().toLowerCase() === name.data.trim().toLowerCase(),
      );
      if (GENERIC_NAME.test(name.data.trim()) || taken)
        throw new ProposeError(`name: ${JSON.stringify(name.data)} says nothing. ${nameHelp}`);
      const purpose = (input.purpose ?? '').trim();
      if (purpose.length < 3)
        throw new ProposeError('purpose: say what it sends, to whom and when, in one sentence');
      const instructions = scheduledAgentInstructions(purpose, input.instructions);
      if ([...instructions].length > AI_INSTRUCTIONS_CHARACTERS)
        throw new ProposeError(
          `The instructions can be at most ${AI_INSTRUCTIONS_CHARACTERS.toLocaleString('en')} characters`,
        );
      const active = ctx.inboxes.repo.active();
      // One agent or one number: every agent serves inbox 1 (as the agent service decides).
      const single = max <= 1 || ctx.inboxes.connections.maxInboxes() <= 1;
      const inboxId = single ? 1 : (input.inboxId ?? (active.length === 1 ? active[0]!.id : null));
      if (inboxId === null)
        throw new ProposeError(
          `Give inboxId, the WhatsApp number it serves: ${active.map((i) => `${i.id} (${i.name})`).join(', ')}`,
        );
      if (!active.some((i) => i.id === inboxId))
        throw new ProposeError(
          `No WhatsApp number ${inboxId}. Numbers: ${active.map((i) => `${i.id} (${i.name})`).join(', ')}`,
        );
      return keep(user, {
        kind: 'agent',
        id: randomUUID(),
        userId: user.id,
        status: 'proposed',
        createdAt: now(),
        name: name.data,
        // Always custom: its role text comes from its purpose, never a preset's help-desk or sales text.
        preset: 'custom',
        inboxId,
        inboxName: inboxName(inboxId),
        instructions,
        note: purpose.slice(0, 300),
      });
    },

    /** Records a new scheduled task (with a preview: nothing sent) for the admin's Apply. */
    async proposeTask(
      user: User,
      input: ProposeTaskInput,
      seen: ReadonlySet<string>,
      signal?: AbortSignal,
    ): Promise<TaskProposal> {
      const agent = agentFor(user, input);
      const chat = chatFor(user, input.chatJid, seen, agent.inboxId);
      const body = ScheduledTaskBody.safeParse({
        name: input.name,
        time: input.time,
        dayRule: input.dayRule,
        days: input.dayRule === 'custom' ? (input.days ?? []) : [],
        chatJid: chat.jid,
        instruction: input.instruction,
      });
      if (!body.success)
        throw new ProposeError(
          `${firstIssue(body.error)} (time is HH:MM in 5-minute steps; days 0 = Sunday … 6 = Saturday)`,
        );
      if (agent.agentId !== null && repo.count(agent.agentId) >= SCHEDULED_TASKS_MAX)
        throw new ProposeError(
          `scheduled_task_limit: this agent has ${SCHEDULED_TASKS_MAX} scheduled tasks, the most it can have`,
        );
      const { enabled: _enabled, ...spec } = body.data;
      return taskProposal(user, {
        agentId: agent.agentId,
        dependsOn: agent.dependsOn,
        agentName: agent.name,
        spec,
        chat: infoOf(chat),
        ...(await previewFields(
          user,
          agent.draft ? { draft: agent.draft } : { agentId: agent.agentId! },
          { jid: chat.jid, taskName: spec.name, instruction: spec.instruction },
          signal,
        )),
        edit: null,
      });
    },

    /** Records a change to an existing scheduled task (the card shows before → after). */
    async proposeTaskEdit(
      user: User,
      input: ProposeTaskEditInput,
      seen: ReadonlySet<string>,
      signal?: AbortSignal,
    ): Promise<TaskProposal> {
      const task = repo.get(input.taskId);
      const agent = task ? agentById(ctx.db, task.agentId) : null;
      if (!task || !agent)
        throw new ProposeError('Unknown taskId: call list_scheduled_tasks first');
      const saved = specOf(task);
      const asked: Partial<TaskSpec> = {};
      for (const key of FIELDS)
        if (input[key] !== undefined) Object.assign(asked, { [key]: input[key] });
      // Days mean chosen days; another day rule has none.
      if (asked.days !== undefined && asked.dayRule === undefined) asked.dayRule = 'custom';
      if (asked.dayRule && asked.dayRule !== 'custom') asked.days = [];
      const patch: Partial<TaskSpec> = {};
      for (const key of FIELDS)
        if (asked[key] !== undefined && !sameValue(asked[key], saved[key]))
          Object.assign(patch, { [key]: asked[key] });
      if (Object.keys(patch).length === 0)
        throw new ProposeError('Nothing changes: the task already has these values');
      const next: TaskSpec = { ...saved, ...patch };
      const checked = ScheduledTaskBody.safeParse(next);
      if (!checked.success) throw new ProposeError(firstIssue(checked.error));
      if (patch.chatJid !== undefined && agent.inboxId === null) throw new ProposeError(NO_NUMBER);
      const chat =
        patch.chatJid !== undefined && agent.inboxId !== null
          ? chatFor(user, patch.chatJid, seen, agent.inboxId)
          : chats.get(task.chatJid);
      const oldChat = chats.get(task.chatJid);
      const original: Partial<TaskSpec> = {};
      for (const key of Object.keys(patch) as (keyof TaskSpec)[])
        Object.assign(original, { [key]: saved[key] });
      // The day fields travel together, so before → after reads right.
      if (patch.dayRule !== undefined || patch.days !== undefined) {
        patch.dayRule = next.dayRule;
        patch.days = next.days;
        original.dayRule = saved.dayRule;
        original.days = saved.days;
      }
      const before: AskEzyTaskBefore = {
        ...(original.name !== undefined ? { name: original.name } : {}),
        ...(original.time !== undefined ? { time: original.time } : {}),
        ...(original.dayRule !== undefined
          ? { dayRule: original.dayRule, days: original.days ?? [] }
          : {}),
        ...(original.instruction !== undefined ? { instruction: original.instruction } : {}),
        ...(original.chatJid !== undefined && oldChat
          ? { chatName: infoOf(oldChat).name, chatEnding: chatEnding(oldChat) }
          : {}),
      };
      const changesText = patch.instruction !== undefined || patch.chatJid !== undefined;
      return taskProposal(user, {
        agentId: agent.id,
        dependsOn: null,
        agentName: displayName(agent),
        spec: next,
        chat: chat ? infoOf(chat) : { name: null, ending: null, type: 'dm' },
        ...(changesText
          ? await previewFields(
              user,
              { agentId: agent.id },
              { jid: next.chatJid, taskName: next.name, instruction: next.instruction },
              signal,
            )
          : { preview: null }),
        edit: { taskId: task.id, updatedAt: task.updatedAt, patch, original, before },
      });
    },

    /** The scheduled tasks of one agent or of every agent, as list_scheduled_tasks returns them. */
    listTasks(user: User, agentId?: number) {
      const agents =
        agentId !== undefined
          ? [agentById(ctx.db, agentId)].filter((a): a is AgentRow => !!a)
          : listAgents(ctx.db);
      if (agentId !== undefined && agents.length === 0)
        throw new ProposeError('Unknown agentId: call list_ai_agents first');
      return agents.flatMap((agent) =>
        repo.list(agent.id).map((task) => {
          const chat = chats.get(task.chatJid);
          const openable =
            chat !== null && canOpenChat(ctx, user, { jid: chat.jid, inbox_id: chat.inboxId });
          return {
            taskId: task.id,
            agentId: agent.id,
            agentName: displayName(agent),
            enabled: task.enabled,
            ...specOf(task),
            chatJid: openable ? task.chatJid : null,
            chatName: openable ? chatLabel(infoOf(chat)) : null,
            chatEnding: openable ? chatEnding(chat) : null,
            timeZone: timeZone(),
          };
        }),
      );
    },

    get(id: string, user: User): SetupProposal | null {
      prune();
      const p = proposals.get(id);
      return p && p.userId === user.id ? p : null;
    },

    has(id: string, user: User): boolean {
      prune();
      return proposals.get(id)?.userId === user.id;
    },

    apply(id: string, user: User, ip: string | null): AskEzyChangeResult {
      const p = own(id, user);
      if (p.kind === 'task') return applyTask(p, user, ip);
      // A new agent is created only with its scheduled task ("Apply both" applies the task).
      if (p.status !== 'applied' || !p.agentId)
        throw new HttpError(
          409,
          'agent_needs_task',
          'A new agent is created together with its scheduled task: apply the task',
        );
      const agentId = applyAgent(p, user, ip);
      return {
        status: 'applied',
        related: [],
        agentId,
        agentOn: agentById(ctx.db, agentId)?.enabled ?? false,
      };
    },

    discard(id: string, user: User): AskEzyChangeResult {
      const p = own(id, user);
      if (p.status === 'applied')
        throw new HttpError(409, 'change_applied', 'Undo the change first');
      p.status = 'discarded';
      return { status: 'discarded', related: [] };
    },

    /** Applied: removes what Apply made (or restores the edited fields). Discarded: shows it again. */
    undo(id: string, user: User, ip: string | null): AskEzyChangeResult {
      const p = own(id, user);
      if (p.status === 'discarded') {
        p.status = 'proposed';
        return { status: 'proposed', related: [] };
      }
      if (p.status !== 'applied') return { status: p.status, related: [] };
      if (p.kind === 'task') return undoTask(p, user, ip);
      return { status: 'proposed', related: undoAgent(p, user, ip) };
    },

    /** Whether Undo can remove a new agent in this edition (Lite keeps its only agent). */
    agentsRemovable: removable,
  };
}

export type SetupStore = ReturnType<typeof createSetupStore>;
