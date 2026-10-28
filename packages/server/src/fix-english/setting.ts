import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import type { SettingsStore } from '../db/settings.js';

/** The team-wide admin switch for Fix English (missing = on). */
export const FIX_ENGLISH_KEY = 'fix_english';
/** Written by migration 025: the install existed before the feature, so it started off. */
export const FIX_ENGLISH_UPGRADED_KEY = 'fix_english_upgraded';

export function fixEnglishEnabled(settings: SettingsStore): boolean {
  return settings.get<unknown>(FIX_ENGLISH_KEY, true) !== false;
}

export function fixEnglishUpgraded(settings: SettingsStore): boolean {
  return settings.get<unknown>(FIX_ENGLISH_UPGRADED_KEY, false) === true;
}

/** Saves the switch; a real change is audited with its before and after values only. */
export function setFixEnglish(
  ctx: AppContext,
  enabled: boolean,
  actor: { userId: number | null; ip: string | null },
): void {
  const before = fixEnglishEnabled(ctx.settings);
  ctx.settings.set(FIX_ENGLISH_KEY, enabled);
  if (before !== enabled)
    audit(ctx.db, {
      userId: actor.userId,
      action: 'fix_english.update',
      ip: actor.ip,
      meta: { before, after: enabled },
    });
}
