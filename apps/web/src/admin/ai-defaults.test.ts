import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_HANDOFF_RULES, DEFAULT_AI_INSTRUCTIONS } from '@wa-team-inbox/shared';
import en from '../i18n/locales/en/admin.json';
import ms from '../i18n/locales/ms/admin.json';
import zh from '../i18n/locales/zh-CN/admin.json';

describe('default AI instructions and hand-off rules in the catalogs', () => {
  it('keeps the English catalog identical to the server defaults', () => {
    expect(en.ai.defaults.instructions).toBe(DEFAULT_AI_INSTRUCTIONS);
    expect(en.ai.defaults.handoffRules).toBe(DEFAULT_AI_HANDOFF_RULES);
  });

  it('translates them for Malay and Chinese admins, with the same structure', () => {
    for (const catalog of [ms, zh]) {
      const { instructions, handoffRules } = catalog.ai.defaults;
      expect(instructions).not.toBe(DEFAULT_AI_INSTRUCTIONS);
      expect(handoffRules).not.toBe(DEFAULT_AI_HANDOFF_RULES);
      // Same sections and the same number of rules as the English source.
      expect(instructions.split('\n').length).toBe(DEFAULT_AI_INSTRUCTIONS.split('\n').length);
      expect(handoffRules.split('\n').length).toBe(DEFAULT_AI_HANDOFF_RULES.split('\n').length);
      expect(instructions).toContain('*');
    }
  });
});
