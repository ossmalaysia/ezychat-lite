import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  AI_AGENT_PRESETS,
  AI_HANDOFF_RULES_CHARACTERS,
  AI_INSTRUCTIONS_CHARACTERS,
  AiContextTextBody,
} from '@ezychat/shared';
import en from '@/i18n/locales/en/admin.json';
import ms from '@/i18n/locales/ms/admin.json';
import zh from '@/i18n/locales/zh-CN/admin.json';
import { presetDefaults } from './ai-status';
import { BUSINESS_TEMPLATES, businessTemplate } from './business-templates';

/** A `t` that reads one catalog (the keys these templates use carry no interpolation). */
const tFor = (catalog: unknown) =>
  ((key: string) => {
    const value = key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
    if (typeof value !== 'string') throw new Error(`missing ${key}`);
    return value;
  }) as unknown as TFunction<'admin'>;

describe.each([
  ['en', en],
  ['ms', ms],
  ['zh-CN', zh],
])('business templates (%s)', (_lang, catalog) => {
  const t = tFor(catalog);

  it.each(BUSINESS_TEMPLATES.map((tpl) => tpl.id))('%s fits every limit and saves', (id) => {
    const tpl = businessTemplate(id, t);
    expect(tpl.agentName.length).toBeGreaterThan(0);
    expect(tpl.agentName.length).toBeLessThanOrEqual(64);
    expect(tpl.instructions.length).toBeLessThanOrEqual(AI_INSTRUCTIONS_CHARACTERS);
    expect(tpl.handoffRules.length).toBeLessThanOrEqual(AI_HANDOFF_RULES_CHARACTERS);
    // Starts from the tested text of its agent type.
    expect(tpl.instructions.startsWith(presetDefaults(tpl.preset, t).instructions)).toBe(true);
    expect(AiContextTextBody.safeParse(tpl.contextItem).success).toBe(true);
    // Fill-in lines are left blank, so the AI never repeats a placeholder as a fact.
    const lines = tpl.contextItem.text.split('\n').slice(2);
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) expect(line).toMatch(/[:：]$/);
  });
});

it('uses one known agent type per template', () => {
  for (const tpl of BUSINESS_TEMPLATES) expect(tpl.preset in AI_AGENT_PRESETS).toBe(true);
});
