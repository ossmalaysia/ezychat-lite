import { useTranslation } from 'react-i18next';
import type { DreamChange } from '@ezychat/shared';
import { useDreamChange, type DreamAction } from '../api/dream';
import { ResponsiveDialog } from '@/components/app';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ErrorState, ListSkeleton } from './adminUi';

/**
 * Dream mode → See change: the old and the new text, the team replies (and the customer questions) it came from,
 * read live from the chat, and the checks it passed. A waiting change can be applied or dismissed here.
 */
export function DreamChangeDialog({
  agentId,
  change,
  when,
  busy,
  onAction,
  onClose,
}: Readonly<{
  agentId: number;
  change: DreamChange;
  when: string;
  busy: boolean;
  onAction: (action: DreamAction) => void;
  onClose: () => void;
}>) {
  const { t } = useTranslation('admin');
  const q = useDreamChange(agentId, change.id);
  const d = q.data;
  const title =
    change.itemId === null && change.target === 'context_text'
      ? t('ai.dream.change.newItem', { name: change.itemName ?? '' })
      : [t(`ai.dream.target.${change.target}`), change.itemName].filter(Boolean).join(' · ');
  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="medium"
      title={title}
      description={t('ai.dream.change.body', { when })}
      footer={
        change.status === 'waiting' ? (
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={busy} onClick={() => onAction('dismiss')}>
              {t('ai.dream.dismiss')}
            </Button>
            <Button disabled={busy} onClick={() => onAction('apply')}>
              {t('ai.dream.apply')}
            </Button>
          </div>
        ) : undefined
      }
    >
      {q.isError ? (
        <div className="pb-4">
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : !d ? (
        <div className="pb-4">
          <ListSkeleton rows={3} />
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-4 text-sm">
          <div className="overflow-hidden rounded-lg border" data-testid="dream-diff">
            {d.before && (
              <div className="bg-destructive/10 px-3 py-2 whitespace-pre-wrap line-through">
                <span className="sr-only">{t('ai.dream.change.before')}: </span>
                {d.before}
              </div>
            )}
            <div className="bg-success/10 px-3 py-2 whitespace-pre-wrap">
              <span className="sr-only">{t('ai.dream.change.after')}: </span>
              {d.after}
            </div>
          </div>
          <section className="flex flex-col gap-2">
            <h3 className="font-medium">{t('ai.dream.change.why')}</h3>
            {d.sources.length === 0 ? (
              <p className="text-muted-foreground">{t('ai.dream.change.whyEmpty')}</p>
            ) : (
              d.sources.map((s, i) => (
                <div key={i} className="rounded-lg bg-muted px-3 py-2">
                  <span className="block text-xs font-medium text-muted-foreground">
                    {s.role === 'team'
                      ? [t('ai.dream.change.team'), s.name].filter(Boolean).join(' · ')
                      : t('ai.dream.change.customer')}
                  </span>
                  <span className="whitespace-pre-wrap">{s.text}</span>
                </div>
              ))
            )}
          </section>
          <section className="flex flex-col gap-1">
            <h3 className="font-medium">{t('ai.dream.change.checks')}</h3>
            <ul className="flex flex-col gap-1">
              {d.checks.map((c) => (
                <li key={c.name} className={cn(c.ok ? 'text-success' : 'text-destructive')}>
                  {c.ok ? '✓' : '✗'} {t(`ai.dream.check.${c.name}`)}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </ResponsiveDialog>
  );
}
