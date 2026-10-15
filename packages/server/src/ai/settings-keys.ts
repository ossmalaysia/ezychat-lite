import type { AiSettings } from '@ezychat/shared';
import type { SettingsStore } from '../db/settings.js';

/** Inbox AI connection (`{ mode, model }`), shared by every AI member. */
export const AI_PROVIDER_KEY = 'ai_inbox_provider';
/** Encrypted OpenAI API key (API-key mode). */
export const AI_SECRET_KEY = 'ai_api_key';

type AiProviderSettings = Pick<AiSettings, 'mode' | 'model'>;

/**
 * The inbox AI connection mode and model. A saved connection keeps its mode (older saves without
 * a mode were API-key mode). Never saved: ChatGPT sign-in, the recommended first-setup choice,
 * unless an API key is already stored. The default only picks what Settings shows; nothing signs
 * in or calls ChatGPT until an admin does, and the AI member stays off until turned on.
 */
export function aiProviderSettings(settings: SettingsStore): AiProviderSettings {
  const stored = settings.get<Partial<AiProviderSettings> | null>(AI_PROVIDER_KEY, null);
  if (stored && typeof stored === 'object')
    return { mode: stored.mode ?? 'api', model: stored.model ?? '' };
  return { mode: settings.getSecret(AI_SECRET_KEY) ? 'api' : 'chatgpt', model: '' };
}

/** The saved OpenAI API key when the inbox AI connection uses API-key mode, else null. */
export function openAiApiKey(settings: SettingsStore): string | null {
  if (aiProviderSettings(settings).mode !== 'api') return null;
  return settings.getSecret(AI_SECRET_KEY);
}
