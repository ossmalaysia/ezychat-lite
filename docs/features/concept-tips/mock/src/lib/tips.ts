/**
 * PROPOSED (concept-tips): the "?" tips that explain a new concept in plain words, where to get
 * what it needs, and a link to the full guide. Copy lives in `common.json` under `mockTips.<topic>`
 * (en, ms, zh-CN); this file holds only the shape of each tip.
 */
export type TipTopic =
  | 'whatsappLink'
  | 'aiConnection'
  | 'apiKey'
  | 'claudeKey'
  | 'aiModel'
  | 'businessContext'
  | 'instructions'
  | 'handoff'
  | 'tryIt'
  | 'voice'
  | 'tunnel'
  | 'lan'
  | 'mcp'
  | 'accessToken'
  | 'connectors';

export interface TipShape {
  /** Number of "How to get it" steps (`step1`…`stepN`); 0 = none. */
  steps: number;
  /** Has a `note` line (safety, cost or the easier alternative). */
  note?: boolean;
  /** Outside page where the thing is made (opened in the OS browser), label in `action`. */
  action?: string;
  /** EzyChat guide slug on ezychat.ai (shown as "Read the guide"). */
  guide?: 'getting-started' | 'set-up-ai-agent' | 'connect-cloudflare' | 'connect-ai-assistant';
}

export const TIPS: Record<TipTopic, TipShape> = {
  whatsappLink: { steps: 0, note: true, guide: 'getting-started' },
  aiConnection: { steps: 3, note: true, guide: 'set-up-ai-agent' },
  apiKey: {
    steps: 4,
    note: true,
    action: 'https://platform.openai.com/api-keys',
    guide: 'set-up-ai-agent',
  },
  claudeKey: {
    steps: 4,
    note: true,
    action: 'https://console.anthropic.com/settings/keys',
    guide: 'set-up-ai-agent',
  },
  aiModel: { steps: 0, note: true },
  businessContext: { steps: 3, guide: 'set-up-ai-agent' },
  instructions: { steps: 0, note: true, guide: 'set-up-ai-agent' },
  handoff: { steps: 0, note: true, guide: 'set-up-ai-agent' },
  tryIt: { steps: 0 },
  voice: { steps: 2, note: true },
  tunnel: { steps: 0, note: true, guide: 'connect-cloudflare' },
  lan: { steps: 0, note: true },
  mcp: { steps: 0, note: true, guide: 'connect-ai-assistant' },
  accessToken: { steps: 0, note: true, guide: 'connect-ai-assistant' },
  connectors: { steps: 0, note: true },
};

const GUIDE_PREFIX: Partial<Record<string, string>> = { ms: '/ms', 'zh-CN': '/zh' };

/**
 * The guide on ezychat.ai in the app's language. The campaign tag lets the website count visits
 * from tips; the app itself sends nothing (no tracking in Lite).
 */
export function guideUrl(slug: string, locale: string, topic: string): string {
  const prefix = GUIDE_PREFIX[locale] ?? '';
  return `https://ezychat.ai${prefix}/guides/${slug}?utm_source=ezychat-lite&utm_medium=app&utm_campaign=tip-${topic}`;
}
