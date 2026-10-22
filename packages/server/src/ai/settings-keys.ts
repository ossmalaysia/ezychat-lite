import type { AiSettings } from '@ezychat/shared';
import type { SettingsStore } from '../db/settings.js';

/** Inbox AI connection (`{ mode, model }`), shared by every AI member. */
export const AI_PROVIDER_KEY = 'ai_inbox_provider';
/** Encrypted OpenAI API key (API-key mode). */
export const AI_SECRET_KEY = 'ai_api_key';
/** Encrypted Anthropic Claude API key (Claude mode). Kept while another mode is selected. */
export const AI_CLAUDE_SECRET_KEY = 'ai_claude_api_key';

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

/** Where a connection mode keeps its API key (ChatGPT sign-in has no key). */
export function secretKeyFor(mode: AiSettings['mode']): string | null {
  if (mode === 'api') return AI_SECRET_KEY;
  if (mode === 'claude') return AI_CLAUDE_SECRET_KEY;
  return null;
}

/** The saved OpenAI API key when the inbox AI connection uses API-key mode, else null. */
export function openAiApiKey(settings: SettingsStore): string | null {
  if (aiProviderSettings(settings).mode !== 'api') return null;
  return settings.getSecret(AI_SECRET_KEY);
}

/** The saved Claude API key when the inbox AI connection uses Claude mode, else null. */
export function claudeApiKey(settings: SettingsStore): string | null {
  if (aiProviderSettings(settings).mode !== 'claude') return null;
  return settings.getSecret(AI_CLAUDE_SECRET_KEY);
}

/**
 * The key the providers receive: the Claude key in Claude mode, else the OpenAI key (unchanged
 * from before Claude: ChatGPT mode ignores it).
 */
export function aiApiKey(settings: SettingsStore): string | null {
  return aiProviderSettings(settings).mode === 'claude'
    ? settings.getSecret(AI_CLAUDE_SECRET_KEY)
    : settings.getSecret(AI_SECRET_KEY);
}
