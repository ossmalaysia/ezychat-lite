import type { AppContext } from '../context.js';
import { HttpError } from '../http/errors.js';
import type { Actor } from './service.js';
import { listSetupVersions, type SetupTarget } from './setup-versions.js';

/**
 * Applies and undoes one setup text change (instructions, hand-off rules or a Business context text item) for Ask Ezy
 * and dream mode. Never overwrites a text someone saved after the change was proposed (409 `setup_changed`).
 */
export interface SetupTextChange {
  agentId: number;
  target: SetupTarget;
  /** context_text: the item (null = a new item, created by apply). */
  itemId: number | null;
  /** The name of a new context_text item. */
  name: string | null;
  /** The text the target held when the change was proposed ('' for a new item). */
  before: string;
  after: string;
}

/** Dream mode applying a change by itself: no person, its summary as the reason. */
export const DREAM_ACTOR = (summary: string): Actor => ({
  userId: null,
  ip: null,
  via: 'dream',
  reason: `Dream mode: ${summary}`.slice(0, 500),
});

const ai = (ctx: AppContext) => {
  const service = ctx.services.ai;
  if (!service) throw new HttpError(503, 'ai_unavailable', 'The AI service is not running');
  return service;
};

/** The text the target has now (null when a context item no longer exists or is too long to edit). */
export function currentSetupText(
  ctx: AppContext,
  c: Pick<SetupTextChange, 'agentId' | 'target' | 'itemId'>,
): string | null {
  if (c.target === 'context_text') {
    if (c.itemId === null) return null;
    try {
      const doc = ai(ctx).document(c.agentId, c.itemId);
      return doc.kind === 'text' && !doc.truncated ? doc.text : null;
    } catch {
      return null;
    }
  }
  const status = ai(ctx).agentStatus(c.agentId);
  return c.target === 'instructions'
    ? status.settings.instructions
    : (status.settings.handoffRules ?? '');
}

/** Saves `text` into the target; returns the item id (a new item's id when one was added). */
function save(ctx: AppContext, c: SetupTextChange, text: string, actor: Actor): number | null {
  const service = ai(ctx);
  if (c.target === 'context_text') {
    if (c.itemId !== null) {
      service.updateText(c.agentId, c.itemId, { text }, actor);
      return c.itemId;
    }
    const before = new Set(service.agentStatus(c.agentId).documents.map((d) => d.id));
    const after = service.addText(c.agentId, { name: c.name ?? 'Dream mode', text }, actor);
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
    actor,
  );
  return null;
}

const latestVersion = (
  ctx: AppContext,
  agentId: number,
  target: SetupTarget,
  itemId: number | null,
) => listSetupVersions(ctx.db, agentId, target, itemId, 1)[0]?.id ?? null;

/** Writes `after` while the target still holds `before`; a new item is created. */
export function applySetupText(
  ctx: AppContext,
  c: SetupTextChange,
  actor: Actor,
): { itemId: number | null; versionId: number | null } {
  const isNewItem = c.target === 'context_text' && c.itemId === null;
  if (!isNewItem && currentSetupText(ctx, c) !== c.before)
    throw new HttpError(409, 'setup_changed', 'The setup changed since this change was suggested');
  const itemId = save(ctx, c, c.after, actor);
  return { itemId, versionId: latestVersion(ctx, c.agentId, c.target, itemId) };
}

/** Restores `before` while the target still holds `after`; an added item is removed. */
export function undoSetupText(ctx: AppContext, c: SetupTextChange, actor: Actor): void {
  if (currentSetupText(ctx, c) !== c.after)
    throw new HttpError(409, 'setup_changed', 'The setup changed after the change was applied');
  if (c.target === 'context_text' && c.before === '' && c.itemId !== null)
    ai(ctx).removeDocument(c.agentId, c.itemId, actor);
  else save(ctx, c, c.before, actor);
}
