import { MessageCircleQuestionMark, PencilLine, ShoppingBag, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AiAgentPreset } from '@ezychat/shared';
import { Badge } from '@/components/ui/badge';

/** The icon of each agent preset (picker, badges). */
export const PRESET_ICON: Record<AiAgentPreset, LucideIcon> = {
  sales: ShoppingBag,
  faq: MessageCircleQuestionMark,
  custom: PencilLine,
};

/** "Sales agent", "FAQ agent", "Custom agent". */
export function PresetBadge({ preset }: Readonly<{ preset: AiAgentPreset }>) {
  const { t } = useTranslation('admin');
  const Icon = PRESET_ICON[preset];
  return (
    <Badge variant="outline" className="gap-1" data-testid="preset-badge">
      <Icon aria-hidden className="size-3" />
      {t('ai.presets.badge', { preset: t(`ai.presets.${preset}`) })}
    </Badge>
  );
}
