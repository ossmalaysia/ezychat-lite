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
import { canOpenChat } from '../inboxes/access.js';
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
  name: string;
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
  preset: AiAgentPreset;
  inboxId?: number;
  instructions?: string;
  purpose?: string;
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
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const firstIssue = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }) =>
  error.issues
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');

export function createSetupStore(ctx: AppContext, now: () => number = Date.now) {
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
  const keep = <T extends SetupProposal>(user: User, p: T): T => {
    prune();
    const mine = [...proposals.values()].filter((x) => x.userId === user.id);
    while (mine.length >= CHANGES_PER_USER) proposals.delete(mine.shift()!.id);
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
      if (agent.inboxId === null)
        throw new ProposeError(
          'This agent serves no WhatsApp number, so it cannot send scheduled messages',
        );
      return {
        agentId: agent.id,
        dependsOn: null,
        inboxId: agent.inboxId,
        name: displayName(agent),
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
    return { agentId: null, dependsOn: pending.id, inboxId: pending.inboxId, name: pending.name };
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
        `chat_not_in_inbox: ${JSON.stringify(chat.name)} is on another WhatsApp number (${inbox.name}); ` +
          `this agent sends only on ${inboxName(agentInbox)}. Nothing was proposed. Say so in a question ` +
          `block (tone "error") and ask what to use instead (an agent of ${inbox.name}, or another chat).`,
      );
    return chat;
  };
  const infoOf = (chat: Chat): ChatInfo => ({
    name: chat.name?.trim() || chat.phone || chat.jid,
    ending: chatEnding(chat),
    type: chat.type === 'group' ? 'group' : 'dm',
  });

  /** One message the agent would send now: nothing is sent or stored; null when there is none. */
  const preview = async (
    user: User,
    agentId: number | null,
    chatJid: string,
    instruction: string,
  ) => {
    if (agentId === null) return null;
    try {
      const result = await scheduled().preview(
        agentId,
        { chatJid, instruction },
        { userId: user.id, ip: null },
      );
      return result.result === 'sent' && result.text ? result.text : null;
    } catch {
      return null;
    }
  };

  const limitText = (max: number) =>
    `agent_limit: this app allows ${max} AI agent${max === 1 ? '' : 's'} and has no room for a new one. ` +
    (ctx.edition === 'lite'
      ? 'Tell the person: "EzyChat Lite has one AI agent, so I can\'t add a new one." (in their language) '
      : 'Tell the person that no more AI agents can be added in this edition ') +
    'in a question block note (tone "warning"), and offer the existing agent instead.';

  const agentRow = (p: AgentProposal) => (p.agentId ? agentById(ctx.db, p.agentId) : null);
  const agentInUse = (agent: AgentRow) =>
    agent.enabled ||
    repo.count(agent.id) > 0 ||
    !!ctx.db.prepare('SELECT 1 FROM chats WHERE assigned_to = ? LIMIT 1').get(agent.userId);

  const applyAgent = (p: AgentProposal, user: User, ip: string | null) => {
    if (p.status === 'applied' && p.agentId) return p.agentId;
    try {
      const status = ai().createAgent(
        {
          displayName: p.name,
          enabled: false,
          preset: p.preset,
          instructions: p.instructions ?? presetTexts(p.preset).instructions,
          inboxId: p.inboxId,
        },
        actor(user, ip, 'new agent'),
      );
      p.agentId = status.agent.id;
      p.status = 'applied';
      logApply(p, 'apply', true);
      return p.agentId;
    } catch (error) {
      logApply(p, 'apply', false, error instanceof HttpError ? error.code : 'error');
      throw error;
    }
  };

  /** Removes the agent Apply created: only while it is off and has no chats or scheduled tasks. */
  const undoAgent = (p: AgentProposal, user: User, ip: string | null) => {
    const agent = agentRow(p);
    if (agent) {
      if (agentInUse(agent))
        throw new HttpError(
          409,
          'agent_in_use',
          'The agent is on, or has chats or scheduled tasks: change it on its page',
        );
      ai().deleteAgent(agent.id, actor(user, ip, 'undo new agent'));
    }
    p.status = 'proposed';
    p.agentId = undefined;
    logApply(p, 'undo', true);
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
      // "Apply both": the agent stays (it is off); the task was not saved, and the card says why.
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
          undoAgent(dep, user, ip);
          p.agentId = null;
          p.createdAgent = false;
        } catch {
          // The agent is in use now: it stays, the task is gone.
        }
        related.push({ id: dep.id, status: dep.status });
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
      if (!name.success) throw new ProposeError(`name: ${firstIssue(name.error)}`);
      if (
        input.instructions !== undefined &&
        [...input.instructions].length > AI_INSTRUCTIONS_CHARACTERS
      )
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
        preset: input.preset,
        inboxId,
        inboxName: inboxName(inboxId),
        instructions: input.instructions?.trim() ? input.instructions : null,
        note: input.purpose?.trim() ? input.purpose.trim().slice(0, 300) : null,
      });
    },

    /** Records a new scheduled task (with a preview: nothing sent) for the admin's Apply. */
    async proposeTask(
      user: User,
      input: ProposeTaskInput,
      seen: ReadonlySet<string>,
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
        preview: await preview(user, agent.agentId, chat.jid, spec.instruction),
        edit: null,
      });
    },

    /** Records a change to an existing scheduled task (the card shows before → after). */
    async proposeTaskEdit(
      user: User,
      input: ProposeTaskEditInput,
      seen: ReadonlySet<string>,
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
      const chat =
        patch.chatJid !== undefined
          ? chatFor(user, patch.chatJid, seen, agent.inboxId ?? -1)
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
        chat: chat ? infoOf(chat) : { name: task.chatJid, ending: null, type: 'dm' },
        preview: changesText ? await preview(user, agent.id, next.chatJid, next.instruction) : null,
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
            chatName: openable ? infoOf(chat).name : null,
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
      // The agent service checks the edition's limit again (409 agent_limit).
      const agentId = applyAgent(p, user, ip);
      return { status: 'applied', related: [], agentId, agentOn: false };
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
      undoAgent(p, user, ip);
      return { status: 'proposed', related: [] };
    },
  };
}

export type SetupStore = ReturnType<typeof createSetupStore>;
