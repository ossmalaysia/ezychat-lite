import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import type { SettingsStore } from '../db/settings.js';

/** The team-wide admin switch for AI reply suggestions (missing = on). */
export const REPLY_SUGGESTIONS_KEY = 'ai_reply_suggestions';
/** Written by migration 020: the install existed before the feature, so it started off. */
export const REPLY_SUGGESTIONS_UPGRADED_KEY = 'ai_reply_suggestions_upgraded';

export function replySuggestionsEnabled(settings: SettingsStore): boolean {
  return settings.get<unknown>(REPLY_SUGGESTIONS_KEY, true) !== false;
}

export function replySuggestionsUpgraded(settings: SettingsStore): boolean {
  return settings.get<unknown>(REPLY_SUGGESTIONS_UPGRADED_KEY, false) === true;
}

/** Saves the switch; a real change is audited with its before and after values only. */
export function setReplySuggestions(
  ctx: AppContext,
  enabled: boolean,
  actor: { userId: number | null; ip: string | null },
): void {
  const before = replySuggestionsEnabled(ctx.settings);
  ctx.settings.set(REPLY_SUGGESTIONS_KEY, enabled);
  if (before !== enabled)
    audit(ctx.db, {
      userId: actor.userId,
      action: 'ai.reply_suggestions.update',
      ip: actor.ip,
      meta: { before, after: enabled },
    });
}
