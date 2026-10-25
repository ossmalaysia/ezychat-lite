import type { TFunction } from 'i18next';
import { Car, GraduationCap, Stethoscope, type LucideIcon } from 'lucide-react';
import type { AiAgentPreset, AiContextTextBody } from '@ezychat/shared';
import { presetDefaults } from './ai-status';

/**
 * Ready-made AI agents for common businesses. A template is the tested starting text of its agent
 * type plus a short business part, its own hand-off rules and one Business context item of
 * fill-in lines (a blank line gives the AI no fact, so it hands the chat over instead of guessing).
 * Texts live in the catalogs (`ai.businessTemplates.<id>.*`), so each language gets its own copy.
 */
export const BUSINESS_TEMPLATES = [
  { id: 'clinic', preset: 'faq', icon: Stethoscope },
  { id: 'carWorkshop', preset: 'sales', icon: Car },
  { id: 'tuition', preset: 'sales', icon: GraduationCap },
] as const satisfies ReadonlyArray<{ id: string; preset: AiAgentPreset; icon: LucideIcon }>;

export type BusinessTemplateId = (typeof BUSINESS_TEMPLATES)[number]['id'];

export interface BusinessTemplateTexts {
  preset: AiAgentPreset;
  agentName: string;
  instructions: string;
  handoffRules: string;
  contextItem: AiContextTextBody;
}

export function businessTemplate(
  id: BusinessTemplateId,
  t: TFunction<'admin'>,
): BusinessTemplateTexts {
  const { preset } = BUSINESS_TEMPLATES.find((tpl) => tpl.id === id)!;
  const key = `ai.businessTemplates.${id}` as const;
  return {
    preset,
    agentName: t(`${key}.agentName`),
    instructions: `${presetDefaults(preset, t).instructions}\n\n${t(`${key}.focus`)}`,
    handoffRules: t(`${key}.handoffRules`),
    contextItem: { name: t(`${key}.contextName`), text: t(`${key}.contextText`) },
  };
}
