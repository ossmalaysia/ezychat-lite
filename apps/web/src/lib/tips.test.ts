import { describe, expect, it } from 'vitest';
import { TIP_TOPICS, TIPS, tipGuideUrl } from './tips';

const catalogs = import.meta.glob<Record<string, unknown>>('../i18n/locales/*/common.json', {
  eager: true,
  import: 'default',
});

describe('tips', () => {
  it('has a shape for every topic and https outside pages only', () => {
    expect(Object.keys(TIPS).sort()).toEqual([...TIP_TOPICS].sort());
    for (const tip of Object.values(TIPS))
      if (tip.action) expect(tip.action.startsWith('https://')).toBe(true);
  });

  it.each(Object.keys(catalogs))('%s has every key each topic needs, and nothing extra', (file) => {
    const tips = catalogs[file]!.tips as Record<string, Record<string, string> | string>;
    for (const label of ['guide', 'showSteps', 'hideSteps'])
      expect(typeof tips[label], `${file} tips.${label}`).toBe('string');
    for (const topic of TIP_TOPICS) {
      const shape = TIPS[topic];
      const expected = [
        'title',
        'body',
        ...Array.from({ length: shape.steps }, (_, i) => `step${i + 1}`),
        ...(shape.action ? ['action'] : []),
      ].sort();
      const text = tips[topic] as Record<string, string>;
      expect(Object.keys(text ?? {}).sort(), `${file} tips.${topic}`).toEqual(expected);
      for (const value of Object.values(text)) expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps every card short: the body is at most 25 words in English', () => {
    const en = catalogs['../i18n/locales/en/common.json']!.tips as Record<
      string,
      { body?: string }
    >;
    for (const topic of TIP_TOPICS)
      expect(en[topic]!.body!.split(/\s+/).length, topic).toBeLessThanOrEqual(25);
  });

  it('builds the guide link in the app language with campaign tags only', () => {
    expect(tipGuideUrl('getting-started', 'en', 'whatsappLink')).toBe(
      'https://ezychat.ai/guides/getting-started?utm_source=ezychat-lite&utm_medium=app&utm_campaign=tip-whatsappLink',
    );
    expect(tipGuideUrl('set-up-ai-agent', 'ms', 'apiKey')).toMatch(
      /^https:\/\/ezychat\.ai\/ms\/guides\/set-up-ai-agent\?/,
    );
    expect(tipGuideUrl('set-up-ai-agent', 'zh-CN', 'apiKey')).toMatch(
      /^https:\/\/ezychat\.ai\/zh\/guides\/set-up-ai-agent\?/,
    );
  });
});
