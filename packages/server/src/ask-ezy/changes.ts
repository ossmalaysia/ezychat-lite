import { randomUUID } from 'node:crypto';
import {
  AI_HANDOFF_RULES_CHARACTERS,
  AI_INSTRUCTIONS_CHARACTERS,
  type AskEzyChangeResult,
  type AskEzyChangeStatus,
  type AskEzyChangeTarget,
  type User,
} from '@ezychat/shared';
import type { AppContext } from '../context.js';
import { HttpError } from '../http/errors.js';
import { listSetupVersions } from '../ai/setup-versions.js';

/** A change Ezy proposed and the admin has not applied yet (kept in memory, per user). */
export interface PendingChange {
  id: string;
  userId: number;
  agentId: number;
  agentName: string;
  target: AskEzyChangeTarget;
  /** context_text: the item (null = a new item, created by Apply). */
  itemId: number | null;
  itemName: string | null;
  before: string;
  after: string;
  reason: string;
  status: AskEzyChangeStatus;
  version?: number;
  createdAt: number;
}

export interface ProposeInput {
  agentId: number;
  target: AskEzyChangeTarget;
  itemId?: number;
  name?: string;
  text: string;
  reason: string;
}

/** A pending change lives this long; Apply after that asks to ask Ezy again. */
export const CHANGE_TTL_MS = 30 * 60_000;
/** At most this many pending changes per user (the oldest go first). */
export const CHANGES_PER_USER = 20;
const ITEM_TEXT_CHARACTERS = 200_000;

/** Thrown for a proposal the tool must refuse; its message is shown to the model. */
export class ProposeError extends Error {}

const codePoints = (text: string) => [...text].length;

/** Lines added and removed between two texts (each line compared whole, order ignored). */
export function lineDiff(before: string, after: string): { added: number; removed: number } {
  const split = (t: string) => t.split('\n').filter((l) => l.trim() !== '');
  const old = split(before);
  const now = split(after);
  const count = (lines: string[], other: string[]) => {
    const left = [...other];
    let n = 0;
    for (const line of lines) {
      const i = left.indexOf(line);
      if (i >= 0) left.splice(i, 1);
      else n++;
    }
    return n;
  };
  return { added: count(now, old), removed: count(old, now) };
}

export function createChangeStore(ctx: AppContext, now: () => number = Date.now) {
  const changes = new Map<string, PendingChange>();
  const ai = () => {
    const service = ctx.services.ai;
    if (!service) throw new HttpError(503, 'ai_unavailable', 'The AI service is not running');
    return service;
  };

  const prune = () => {
    for (const [id, c] of changes) if (now() - c.createdAt > CHANGE_TTL_MS) changes.delete(id);
  };

  /** The text the target has now (null when a context item no longer exists). */
  const currentText = (c: Pick<PendingChange, 'agentId' | 'target' | 'itemId'>): string | null => {
    if (c.target === 'context_text') {
      if (c.itemId === null) return null;
      try {
        const doc = ai().document(c.agentId, c.itemId);
        return doc.kind === 'text' && !doc.truncated ? doc.text : null;
      } catch {
        return null;
      }
    }
    const status = ai().agentStatus(c.agentId);
    return c.target === 'instructions'
      ? status.settings.instructions
      : (status.settings.handoffRules ?? '');
  };

  const actor = (user: User, ip: string | null, why: string) => ({
    userId: user.id,
    ip,
    via: 'app' as const,
    reason: `Ask Ezy: ${why}`.slice(0, 500),
  });

  /** Saves `text` into the change's target; returns the new item id for an added item. */
  const save = (user: User, ip: string | null, c: PendingChange, text: string, why: string) => {
    const service = ai();
    const who = actor(user, ip, why);
    if (c.target === 'context_text') {
      if (c.itemId !== null) {
        service.updateText(c.agentId, c.itemId, { text }, who);
        return c.itemId;
      }
      const before = new Set(service.agentStatus(c.agentId).documents.map((d) => d.id));
      const after = service.addText(c.agentId, { name: c.itemName ?? 'Ask Ezy', text }, who);
      return after.documents.find((d) => !before.has(d.id))?.id ?? null;
    }
    const status = service.agentStatus(c.agentId);
    service.saveAgent(
      c.agentId,
      {
        displayName: status.agent.displayName,
        enabled: status.agent.enabled,
        instructions: c.target === 'instructions' ? text : status.settings.instructions,
        handoffRules: c.target === 'handoff_rules' ? text : (status.settings.handoffRules ?? ''),
      },
      who,
    );
    return null;
  };

  const latestVersion = (c: PendingChange) =>
    listSetupVersions(ctx.db, c.agentId, c.target, c.itemId, 1)[0]?.id;

  const own = (id: string, user: User): PendingChange => {
    prune();
    const c = changes.get(id);
    if (!c || c.userId !== user.id)
      throw new HttpError(404, 'change_not_found', 'This suggestion expired. Ask Ezy again.');
    return c;
  };

  return {
    /** Records a proposal for the admin's Apply; never writes the setup. */
    propose(user: User, input: ProposeInput): PendingChange {
      prune();
      const service = ai();
      let status;
      try {
        status = service.agentStatus(input.agentId);
      } catch {
        throw new ProposeError('Unknown agentId: call list_ai_agents first');
      }
      const limit =
        input.target === 'instructions'
          ? AI_INSTRUCTIONS_CHARACTERS
          : input.target === 'handoff_rules'
            ? AI_HANDOFF_RULES_CHARACTERS
            : ITEM_TEXT_CHARACTERS;
      if (codePoints(input.text) > limit)
        throw new ProposeError(`The text can be at most ${limit.toLocaleString('en')} characters`);
      let itemId: number | null = null;
      let itemName: string | null = null;
      if (input.target === 'context_text') {
        if (input.itemId !== undefined) {
          const doc = status.documents.find((d) => d.id === input.itemId);
          if (!doc) throw new ProposeError('Unknown itemId: read get_ai_agent_setup first');
          if (doc.kind !== 'text') throw new ProposeError('Only text items can be changed');
          itemId = doc.id;
          itemName = doc.name;
        } else {
          if (!input.name) throw new ProposeError('Give a name to add a new text item');
          itemName = input.name;
        }
      } else if (input.itemId !== undefined || input.name !== undefined) {
        throw new ProposeError('itemId and name apply to context_text only');
      }
      const before =
        itemId === null && input.target === 'context_text'
          ? ''
          : currentText({ agentId: input.agentId, target: input.target, itemId });
      if (before === null) throw new ProposeError('This item is too long to change here');
      if (before === input.text)
        throw new ProposeError('The new text is the same as the saved text');
      const mine = [...changes.values()].filter((c) => c.userId === user.id);
      while (mine.length >= CHANGES_PER_USER) changes.delete(mine.shift()!.id);
      const change: PendingChange = {
        id: randomUUID(),
        userId: user.id,
        agentId: input.agentId,
        agentName: status.agent.displayName,
        target: input.target,
        itemId,
        itemName,
        before,
        after: input.text,
        reason: input.reason,
        status: 'proposed',
        createdAt: now(),
      };
      changes.set(change.id, change);
      return change;
    },

    get(id: string, user: User): PendingChange | null {
      prune();
      const c = changes.get(id);
      return c && c.userId === user.id ? c : null;
    },

    apply(id: string, user: User, ip: string | null): AskEzyChangeResult {
      const c = own(id, user);
      if (c.status === 'applied') return { status: 'applied', version: c.version };
      const isNewItem = c.target === 'context_text' && c.itemId === null;
      // Someone saved this text after Ezy read it: never overwrite their change.
      if (!isNewItem && currentText(c) !== c.before)
        throw new HttpError(409, 'setup_changed', 'The setup changed since Ezy read it');
      const itemId = save(user, ip, c, c.after, c.reason);
      if (isNewItem) c.itemId = itemId;
      c.status = 'applied';
      c.version = latestVersion(c);
      return { status: 'applied', version: c.version };
    },

    discard(id: string, user: User): AskEzyChangeResult {
      const c = own(id, user);
      if (c.status === 'applied')
        throw new HttpError(409, 'change_applied', 'Undo the change first');
      c.status = 'discarded';
      return { status: 'discarded' };
    },

    /** Applied: saves the text from before (a new item is removed). Discarded: shows it again. */
    undo(id: string, user: User, ip: string | null): AskEzyChangeResult {
      const c = own(id, user);
      if (c.status === 'discarded') {
        c.status = 'proposed';
        return { status: 'proposed' };
      }
      if (c.status !== 'applied') return { status: c.status };
      if (currentText(c) !== c.after)
        throw new HttpError(409, 'setup_changed', 'The setup changed after the change was applied');
      if (c.target === 'context_text' && c.before === '' && c.itemId !== null) {
        ai().removeDocument(c.agentId, c.itemId, actor(user, ip, 'undo'));
        c.itemId = null;
      } else {
        save(user, ip, c, c.before, 'undo');
      }
      c.status = 'proposed';
      c.version = undefined;
      return { status: 'proposed' };
    },
  };
}

export type ChangeStore = ReturnType<typeof createChangeStore>;
