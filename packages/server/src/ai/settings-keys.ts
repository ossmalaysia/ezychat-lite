import type { SettingsStore } from '../db/settings.js';

/** Inbox AI connection (`{ mode, model }`), shared by every AI member. */
export const AI_PROVIDER_KEY = 'ai_inbox_provider';
/** Encrypted OpenAI API key (API-key mode). */
export const AI_SECRET_KEY = 'ai_api_key';

/** The saved OpenAI API key when the inbox AI connection uses API-key mode, else null. */
export function openAiApiKey(settings: SettingsStore): string | null {
  const provider = settings.get<{ mode?: unknown }>(AI_PROVIDER_KEY, {});
  if ((provider?.mode ?? 'api') !== 'api') return null;
  return settings.getSecret(AI_SECRET_KEY);
}
