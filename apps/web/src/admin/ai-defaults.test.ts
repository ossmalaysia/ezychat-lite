import { describe, expect, it } from 'vitest';
import { AI_AGENT_PRESETS } from '@ezychat/shared';
import en from '../i18n/locales/en/admin.json';
import ms from '../i18n/locales/ms/admin.json';
import zh from '../i18n/locales/zh-CN/admin.json';

const PRESETS = ['sales', 'faq'] as const;

describe('preset starting texts in the catalogs', () => {
  it.each(PRESETS)('keeps the English %s texts identical to the server presets', (preset) => {
    expect(en.ai.defaults[preset]).toEqual(AI_AGENT_PRESETS[preset]);
  });

  it.each(PRESETS)('translates the %s texts for Malay and Chinese, same structure', (preset) => {
    const source = AI_AGENT_PRESETS[preset];
    for (const catalog of [ms, zh]) {
      const { instructions, handoffRules } = catalog.ai.defaults[preset];
      expect(instructions).not.toBe(source.instructions);
      expect(handoffRules).not.toBe(source.handoffRules);
      // Same sections and the same number of rules as the English source.
      expect(instructions.split('\n').length).toBe(source.instructions.split('\n').length);
      expect(handoffRules.split('\n').length).toBe(source.handoffRules.split('\n').length);
      expect(instructions).toContain('*');
    }
  });
});
