import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { useMockClaude } from '../mock/claude';
import { setMockImageDetail, useMockImageDetail, type ImageDetail } from '../mock/imageDetail';

/**
 * Proposed (ai-image-detail): Settings → AI → Images from customers. How large customer images
 * reach the AI with a ChatGPT sign-in or an OpenAI API key; Claude always reads them in detail,
 * so the choice is replaced by a note under the Claude connection.
 */
export function AiImageSection() {
  const { t } = useTranslation('admin');
  const groupLabel = useId();
  const claude = useMockClaude().active;
  const value = useMockImageDetail();
  const options: Array<{ value: ImageDetail; label: string; hint: string }> = [
    { value: 'detailed', label: t('ai.images.detailed'), hint: t('ai.images.detailedHint') },
    { value: 'fast', label: t('ai.images.fast'), hint: t('ai.images.fastHint') },
  ];

  return (
    <Card className="gap-4" data-testid="ai-images">
      <CardHeader>
        <CardTitle>{t('ai.images.title')}</CardTitle>
        <CardDescription>{t('ai.images.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {claude ? (
          <p className="text-sm text-muted-foreground">{t('ai.images.claudeNote')}</p>
        ) : (
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend id={groupLabel} className="mb-2 text-sm font-medium">
              {t('ai.images.quality')}
            </legend>
            <RadioGroup
              aria-labelledby={groupLabel}
              value={value}
              onValueChange={(next) => {
                setMockImageDetail(next as ImageDetail);
                toast.success(t('ai.images.saved'));
              }}
              className="grid gap-2 sm:grid-cols-2"
            >
              {options.map((option) => {
                const id = `ai-images-${option.value}`;
                return (
                  <Label
                    key={option.value}
                    htmlFor={id}
                    className={cn(
                      'flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 leading-normal transition-colors hover:bg-accent',
                      value === option.value && 'border-primary bg-primary/5',
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <RadioGroupItem id={id} value={option.value} />
                      {option.label}
                    </span>
                    <span className="font-normal text-muted-foreground">{option.hint}</span>
                  </Label>
                );
              })}
            </RadioGroup>
          </fieldset>
        )}
      </CardContent>
    </Card>
  );
}
