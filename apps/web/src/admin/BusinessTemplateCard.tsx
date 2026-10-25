import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { BUSINESS_TEMPLATES, type BusinessTemplateId } from './business-templates';

/**
 * "Start from a business template": the ready-made agents as cards. Apply fills the page's draft
 * (the admin checks it and saves); `pendingItem` names the Business context item the next Save adds.
 */
export function BusinessTemplateCard({
  disabled,
  pendingItem,
  onApply,
}: {
  disabled: boolean;
  pendingItem: string | null;
  onApply: (id: BusinessTemplateId) => void;
}) {
  const { t } = useTranslation('admin');
  const titleId = useId();
  const [selected, setSelected] = useState<BusinessTemplateId | null>(null);
  return (
    <Card className="gap-4" data-testid="business-templates">
      <CardHeader>
        <CardTitle id={titleId}>{t('ai.businessTemplates.title')}</CardTitle>
        <CardDescription>{t('ai.businessTemplates.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <RadioGroup
          aria-labelledby={titleId}
          value={selected ?? ''}
          onValueChange={(value) => setSelected(value as BusinessTemplateId)}
          className="grid gap-3 sm:grid-cols-3"
        >
          {BUSINESS_TEMPLATES.map(({ id, preset, icon: Icon }) => {
            const optionId = `${titleId}-${id}`;
            return (
              <Label
                key={id}
                htmlFor={optionId}
                className={cn(
                  'flex min-h-11 cursor-pointer flex-col items-start gap-2 rounded-lg border bg-card p-4 font-normal transition-colors',
                  'hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5',
                  'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <Icon aria-hidden className="size-4 text-primary" />
                  <span className="font-medium">{t(`ai.businessTemplates.${id}.name`)}</span>
                  {/* Named by the business only: the type line below would make "FAQ" ambiguous. */}
                  <RadioGroupItem
                    id={optionId}
                    value={id}
                    aria-label={t(`ai.businessTemplates.${id}.name`)}
                    className="ml-auto"
                  />
                </span>
                <span className="text-xs text-muted-foreground">{t(`ai.presets.${preset}`)}</span>
                <span className="text-sm text-muted-foreground">
                  {t(`ai.businessTemplates.${id}.description`)}
                </span>
              </Label>
            );
          })}
        </RadioGroup>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="min-w-0 flex-[1_1_240px] text-sm text-muted-foreground">
            {pendingItem
              ? t('ai.businessTemplates.pendingItem', { item: pendingItem })
              : t('ai.businessTemplates.applyHint')}
          </p>
          <Button
            type="button"
            size="touch"
            className="md:min-h-9"
            disabled={disabled || selected === null}
            onClick={() => selected && onApply(selected)}
          >
            {t('ai.businessTemplates.apply')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
