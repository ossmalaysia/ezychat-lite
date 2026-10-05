import type { AiMemberStatus, AiSettings } from '@wa-team-inbox/shared';

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

export type AiKnowledgeDraft = Pick<AiSettings, 'displayName' | 'instructions' | 'context'>;

export function hasKnowledge(draft: AiKnowledgeDraft, documents: number): boolean {
  return Boolean(draft.instructions.trim() || draft.context.trim() || documents > 0);
}

export type AiPill = 'off' | 'on' | 'needsConnection' | 'needsKnowledge';

export function memberPill(status: AiMemberStatus, draft: AiKnowledgeDraft): AiPill {
  if (!connectionReady(status)) return 'needsConnection';
  if (!hasKnowledge(draft, status.documents.length)) return 'needsKnowledge';
  return status.member && !status.member.disabled ? 'on' : 'off';
}
