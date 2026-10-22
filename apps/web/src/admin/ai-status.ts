import type { TFunction } from 'i18next';
import {
  AI_AGENT_PRESETS,
  type AiAgentPreset,
  type AiDocument,
  type AiMemberStatus,
  type AiSettings,
} from '@ezychat/shared';
import { i18n } from '@/i18n';

/** Only the official ChatGPT sign-in hosts may be opened from the app. */
export function officialLoginUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' &&
      ['auth.openai.com', 'chatgpt.com'].includes(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** The saved connection can answer customers right now. */
export function connectionReady(status: AiMemberStatus): boolean {
  return status.settings.mode === 'api'
    ? status.hasApiKey
    : status.connection.state === 'connected';
}

export type AiKnowledgeDraft = Pick<AiSettings, 'displayName' | 'instructions'> & {
  handoffRules: string;
};

/** Business facts to answer from: a context item with text. Instructions alone are not enough. */
export function hasKnowledge(documents: readonly AiDocument[]): boolean {
  return documents.some((doc) => doc.characters > 0);
}

export type AiPill = 'off' | 'on' | 'needsConnection' | 'needsKnowledge';

export function memberPill(status: AiMemberStatus): AiPill {
  if (!connectionReady(status)) return 'needsConnection';
  if (!hasKnowledge(status.documents)) return 'needsKnowledge';
  return status.member && !status.member.disabled ? 'on' : 'off';
}

export type PresetTexts = { instructions: string; handoffRules: string };
type PresetField = keyof PresetTexts;
const TEXT_PRESETS = Object.keys(AI_AGENT_PRESETS) as Exclude<AiAgentPreset, 'custom'>[];

/** A preset's starting texts in the admin's language (`ai.defaults.<preset>.*`); Custom is blank. */
export function presetDefaults(preset: AiAgentPreset, t: TFunction<'admin'>): PresetTexts {
  if (preset === 'custom') return { instructions: '', handoffRules: '' };
  return {
    instructions: t(`ai.defaults.${preset}.instructions`),
    handoffRules: t(`ai.defaults.${preset}.handoffRules`),
  };
}

/**
 * True when `text` is an unedited starting text of any preset: the English one the server keeps,
 * or the copy in any language whose catalog is loaded. A blank text is never a default.
 */
export function isPresetDefault(text: string, field: PresetField): boolean {
  if (!text) return false;
  for (const preset of TEXT_PRESETS) {
    if (AI_AGENT_PRESETS[preset][field] === text) return true;
    for (const locale of Object.keys(i18n.store?.data ?? {}))
      if (i18n.getResource(locale, 'admin', `ai.defaults.${preset}.${field}`) === text) return true;
  }
  return false;
}
