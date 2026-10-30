import { useTranslation } from 'react-i18next';
import { BotMessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAskEzy, type AskEzyRequest } from './AskEzyContext';

/** Opens Ask Ezy. `compact` shows only the icon (phone headers); the label stays for screen readers. */
export function AskEzyButton({
  request,
  compact,
  variant = 'ghost',
  className,
}: {
  request?: AskEzyRequest;
  compact?: boolean;
  variant?: 'ghost' | 'outline';
  className?: string;
}) {
  const { t } = useTranslation('inbox');
  const { openPanel } = useAskEzy();
  return (
    <Button
      variant={variant}
      size={compact ? 'icon-touch' : 'touch'}
      className={cn('text-primary', className)}
      onClick={() => openPanel(request)}
      aria-label={compact ? t('askEzy.open') : undefined}
      title={t('askEzy.open')}
      data-testid="ask-ezy-open"
    >
      <BotMessageSquare aria-hidden />
      {!compact && t('askEzy.button')}
    </Button>
  );
}
