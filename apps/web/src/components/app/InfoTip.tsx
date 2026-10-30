import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, CircleHelp, ExternalLink } from 'lucide-react';
import { useAppLinks } from '@/lib/app-links';
import { TIPS, type TipTopic } from '@/lib/tips';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** A tip's text when an edition brings its own concept (core topics use `topic`). */
export interface InfoTipContent {
  /** "What is …?": also the "?" button's accessible name. */
  title: string;
  /** One or two plain sentences. */
  body: string;
  /** Folded "Show steps" lines. */
  steps?: readonly string[];
  /** The outside page where the thing is made (https only). */
  action?: { href: string; label: string };
  /** A full guide page (https only). */
  guideHref?: string;
}

export type InfoTipProps = { className?: string } & ({ topic: TipTopic } | InfoTipContent);

const httpsOnly = (href: string | undefined): string | undefined =>
  href?.startsWith('https://') ? href : undefined;

/** The core topic's text from the `common` catalog. */
function useTopicContent(topic: TipTopic | undefined): InfoTipContent | null {
  const { t: typedT, i18n } = useTranslation('common');
  const links = useAppLinks();
  if (!topic) return null;
  // Keys are built from the topic; tips.test.ts checks that every topic's keys exist in each catalog.
  const t = typedT as unknown as (key: string) => string;
  const tip = TIPS[topic];
  const key = (part: string) => `tips.${topic}.${part}`;
  return {
    title: t(key('title')),
    body: t(key('body')),
    steps: Array.from({ length: tip.steps }, (_, i) => t(key(`step${i + 1}`))),
    action: tip.action ? { href: tip.action, label: t(key('action')) } : undefined,
    guideHref: tip.guide && links.guide ? links.guide(tip.guide, i18n.language, topic) : undefined,
  };
}

/**
 * A small "?" after a label or title that names a new concept (API key, model, hand-over…). Click or
 * tap opens a short card: what it is in one or two sentences, then one row of actions (the outside
 * page where it is made, "Show steps" when there are steps, "Full guide"). Steps stay folded until
 * asked for and sit under the buttons, so the buttons stay on screen on a phone. Nothing is sent or
 * saved. Keep it outside the heading or label element so their accessible names stay clean.
 */
export function InfoTip(props: InfoTipProps) {
  const { t } = useTranslation('common');
  const topicContent = useTopicContent('topic' in props ? props.topic : undefined);
  const content = topicContent ?? (props as InfoTipContent);
  const [showSteps, setShowSteps] = useState(false);
  const stepsId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const steps = content.steps ?? [];
  const actionHref = httpsOnly(content.action?.href);
  const guideHref = httpsOnly(content.guideHref);
  const hasRow = Boolean(actionHref) || steps.length > 0 || Boolean(guideHref);
  return (
    <Popover onOpenChange={(open) => !open && setShowSteps(false)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={content.title}
          data-tip={'topic' in props ? props.topic : undefined}
          className={cn(
            // 16 px icon, 44 px hit area (the ::after box) so it is easy to tap on a phone.
            'relative inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground',
            'transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            'after:absolute after:-inset-3 after:content-[""] data-[state=open]:text-primary',
            props.className,
          )}
        >
          <CircleHelp className="size-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={cardRef}
        align="start"
        collisionPadding={16}
        className="flex max-h-(--radix-popover-content-available-height) w-[min(20rem,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto text-sm"
      >
        <p className="font-semibold">{content.title}</p>
        <p className="text-muted-foreground">{content.body}</p>
        {hasRow && (
          <div className="flex flex-wrap items-center gap-x-3">
            {actionHref && content.action && (
              <Button asChild size="touch" variant="outline" className="md:min-h-9">
                <a href={actionHref} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden />
                  {content.action.label}
                </a>
              </Button>
            )}
            {steps.length > 0 && (
              <Button
                type="button"
                size="touch"
                variant="link"
                className="px-0 md:min-h-9"
                aria-expanded={showSteps}
                aria-controls={stepsId}
                onClick={() => {
                  setShowSteps((v) => !v);
                  // The card grows: keep all of it on screen.
                  requestAnimationFrame(() =>
                    cardRef.current?.scrollIntoView?.({ block: 'nearest' }),
                  );
                }}
              >
                {showSteps ? t('tips.hideSteps') : t('tips.showSteps')}
                <ChevronDown
                  aria-hidden
                  className={cn('transition-transform', showSteps && 'rotate-180')}
                />
              </Button>
            )}
            {guideHref && (
              <Button asChild size="touch" variant="link" className="px-0 md:min-h-9">
                <a href={guideHref} target="_blank" rel="noopener noreferrer">
                  {t('tips.guide')}
                </a>
              </Button>
            )}
          </div>
        )}
        {showSteps && (
          <ol
            id={stepsId}
            className="flex list-decimal flex-col gap-0.5 pl-5 text-muted-foreground marker:text-foreground"
          >
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  );
}
