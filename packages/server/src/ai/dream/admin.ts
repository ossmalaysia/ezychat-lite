import type {
  DreamChange,
  DreamChangeDetail,
  DreamHistory,
  DreamSettings,
  DreamSettingsBody,
  DreamSource,
} from '@ezychat/shared';
import type { AppContext } from '../../context.js';
import { audit } from '../../db/audit.js';
import { HttpError } from '../../http/errors.js';
import { agentById } from '../agents.js';
import { applySetupText, undoSetupText, type SetupTextChange } from '../setup-apply.js';
import { DreamRepo, changeView, type ChangeRow } from './repo.js';

/**
 * Dream mode for admins (design §7–§8): settings, the history, one change with its sources, and Apply / Dismiss /
 * Undo. Every write is audited with ids (and the settings before/after), never setup text.
 */
interface Actor {
  userId: number;
  ip: string | null;
}

const requireAgent = (ctx: AppContext, agentId: number) => {
  if (!agentById(ctx.db, agentId)) throw new HttpError(404, 'agent_not_found', 'Unknown AI agent');
};

const requireChange = (repo: DreamRepo, agentId: number, id: number): ChangeRow => {
  const change = repo.change(id);
  if (change?.agentId !== agentId) throw new HttpError(404, 'change_not_found', 'Unknown change');
  return change;
};

const setupChange = (c: ChangeRow): SetupTextChange => ({
  agentId: c.agentId,
  target: c.target,
  itemId: c.itemId,
  name: c.itemName,
  before: c.before,
  after: c.after,
});

export function dreamAdmin(ctx: AppContext) {
  const repo = new DreamRepo(ctx.db);
  const actorOf = (a: Actor, summary: string) => ({
    userId: a.userId,
    ip: a.ip,
    via: 'app' as const,
    reason: `Dream mode: ${summary}`.slice(0, 500),
  });
  const log = (a: Actor, action: string, meta: Record<string, unknown>) =>
    audit(ctx.db, { userId: a.userId, action, ip: a.ip, meta });

  return {
    history(agentId: number, before: number | null): DreamHistory {
      requireAgent(ctx, agentId);
      const ai = ctx.services.ai;
      return {
        settings: repo.settings(agentId),
        ...repo.history(agentId, before),
        aiReady: !!ai && ai.draftConnection() === 'ready' && ctx.access.state().open,
      };
    },

    saveSettings(agentId: number, body: DreamSettingsBody, a: Actor): DreamSettings {
      requireAgent(ctx, agentId);
      const { before, after } = repo.saveSettings(agentId, body, Date.now());
      log(a, 'dream.settings', { agentId, before, after });
      return after;
    },

    detail(agentId: number, id: number): DreamChangeDetail {
      const c = requireChange(repo, agentId, id);
      const read = ctx.db.prepare(
        `SELECT m.from_me AS fromMe, u.display_name AS name, m.body AS text, m.created_at AS at FROM messages m
           LEFT JOIN users u ON u.id = m.sent_by_user_id
          WHERE m.id = ? AND m.deleted_at IS NULL AND m.hidden_at IS NULL AND m.body IS NOT NULL`,
      );
      const sources = c.sourceMessageIds.flatMap((messageId): DreamSource[] => {
        const m = read.get(messageId) as
          { fromMe: number; name: string | null; text: string; at: number } | undefined;
        if (!m) return [];
        return [
          {
            role: m.fromMe ? 'team' : 'customer',
            name: m.fromMe ? m.name : null,
            at: m.at,
            text: m.text,
          },
        ];
      });
      return { ...changeView(c), before: c.before, after: c.after, checks: c.checks, sources };
    },

    apply(agentId: number, id: number, a: Actor): DreamChange {
      const c = requireChange(repo, agentId, id);
      if (c.status !== 'waiting')
        throw new HttpError(409, 'change_not_waiting', 'This change is not waiting any more');
      let result;
      try {
        result = applySetupText(ctx, setupChange(c), actorOf(a, c.summary));
      } catch (error) {
        if (error instanceof HttpError && error.code === 'setup_changed')
          repo.setStatus(id, 'stale', { decidedBy: a.userId, now: Date.now() });
        throw error;
      }
      if (result.itemId !== c.itemId)
        ctx.db
          .prepare('UPDATE ai_dream_changes SET item_id = ? WHERE id = ?')
          .run(result.itemId, id);
      repo.setStatus(id, 'applied', {
        versionId: result.versionId,
        decidedBy: a.userId,
        now: Date.now(),
      });
      log(a, 'dream.change.applied', { changeId: id, agentId, auto: false });
      return changeView(repo.change(id)!);
    },

    dismiss(agentId: number, id: number, a: Actor): DreamChange {
      const c = requireChange(repo, agentId, id);
      if (c.status !== 'waiting')
        throw new HttpError(409, 'change_not_waiting', 'This change is not waiting any more');
      repo.setStatus(id, 'dismissed', { decidedBy: a.userId, now: Date.now() });
      log(a, 'dream.change.dismissed', { changeId: id, agentId });
      return changeView(repo.change(id)!);
    },

    undo(agentId: number, id: number, a: Actor): DreamChange {
      const c = requireChange(repo, agentId, id);
      if (c.status !== 'applied')
        throw new HttpError(409, 'change_not_applied', 'This change is not applied');
      undoSetupText(ctx, setupChange(c), actorOf(a, `undo ${c.summary}`));
      repo.setStatus(id, 'undone', { decidedBy: a.userId, now: Date.now() });
      log(a, 'dream.change.undone', { changeId: id, agentId });
      return changeView(repo.change(id)!);
    },
  };
}
