import { CircleHelp, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TIPS, guideUrl, type TipTopic } from '@/lib/tips';

/**
 * PROPOSED (concept-tips): a small "?" next to a label or title. Click or tap opens a card that says
 * what the concept is in plain words, how to get it (numbered steps and a button to the outside page)
 * and a link to the full guide. Nothing is sent or saved; it closes with Esc or a click outside.
 */
export function InfoTip({ topic, className }: { topic: TipTopic; className?: string }) {
  const { t: typedT, i18n } = useTranslation('common');
  // Keys are built from the topic; the catalog tests check every topic's keys exist.
  const t = typedT as unknown as (key: string) => string;
  const tip = TIPS[topic];
  const key = (part: string) => `mockTips.${topic}.${part}`;
  const steps = Array.from({ length: tip.steps }, (_, i) => t(key(`step${i + 1}`)));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t(key('title'))}
          data-tip={topic}
          className={cn(
            // 20 px icon, 44 px hit area (the ::after box) so it is easy to tap on a phone.
            'relative inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground',
            'transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            'data-[state=open]:text-primary after:absolute after:-inset-3 after:content-[""]',
            className,
          )}
        >
          <CircleHelp className="size-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="flex max-h-(--radix-popover-content-available-height) w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto text-sm"
      >
        <p className="font-semibold">{t(key('title'))}</p>
        <p className="text-muted-foreground">{t(key('body'))}</p>
        {steps.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="font-medium">{t(key('stepsTitle'))}</p>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-muted-foreground marker:text-foreground">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        )}
        {tip.note && (
          <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">{t(key('note'))}</p>
        )}
        {(tip.action || tip.guide) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {tip.action && (
              <Button asChild size="touch" variant="outline">
                <a href={tip.action} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden />
                  {t(key('action'))}
                </a>
              </Button>
            )}
            {tip.guide && (
              <Button asChild size="touch" variant="link" className="px-0">
                <a
                  href={guideUrl(tip.guide, i18n.language, topic)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('mockTips.guide')}
                </a>
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
