import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EnrichmentAudit, ENRICHMENT_WEIGHTS, type AuditEntry } from '@ezychat/shared';
import { ResponsiveDialog } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const criteria = ['ownership', 'clarity', 'context', 'validation', 'freshness'] as const;
export function EnrichmentAuditScore({ entry }: Readonly<{ entry: AuditEntry }>) {
  const { t } = useTranslation('admin');
  const [open, setOpen] = useState(false);
  const parsed = EnrichmentAudit.safeParse(entry.meta.enrichment);
  if (entry.action !== 'customer.enrichment_update' || !parsed.success) return null;
  const record = parsed.data;
  const label = t('enrichment.average', { score: Math.round(record.average) });
  return (
    <>
      <Button
        variant="link"
        size="touch"
        className="gap-1 px-0 underline has-[>svg]:px-0 md:pointer-fine:min-h-8"
        aria-label={`${t('enrichment.details')}: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {label}
        <ChevronRight aria-hidden className="size-3.5" />
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        size="medium"
        title={t('enrichment.details')}
        description={t('enrichment.meaning')}
        footer={
          <Button variant="outline" size="touch" onClick={() => setOpen(false)}>
            {t('enrichment.close')}
          </Button>
        }
      >
        <div className="space-y-5">
          <div className="flex items-center gap-4 border-b pb-4">
            <strong className="text-3xl">
              {Math.round(record.average)}
              <span className="text-base font-normal text-muted-foreground">/100</span>
            </strong>
            <p className="text-sm text-muted-foreground">
              {t('enrichment.savedFields', { count: record.fields.length })}
            </p>
          </div>
          {record.fields.map((field) => (
            <section key={field.field} className="space-y-3 border-b pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{t(`enrichment.fields.${field.field}`)}</strong>
                  <Badge variant="secondary">{t(`enrichment.${field.operation}`)}</Badge>
                </div>
                <div className="shrink-0 text-right">
                  <strong>{field.score}/100</strong>
                  <p className="text-xs text-muted-foreground">
                    {t('enrichment.threshold', { score: field.threshold })}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {t(`enrichment.reasons.${field.reason}`)}
              </p>
              <dl className="space-y-2">
                {criteria.map((criterion) => (
                  <div key={criterion} className="flex justify-between gap-4 text-sm">
                    <dt className="text-muted-foreground">
                      {t(`enrichment.criteria.${criterion}`)}
                    </dt>
                    <dd className="shrink-0">
                      {field.points[criterion]} / {ENRICHMENT_WEIGHTS[criterion]}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {typeof entry.meta.chatJid === 'string' && (
            <Button asChild variant="link" size="touch">
              <Link to={`/chats/${encodeURIComponent(entry.meta.chatJid)}?customer=1`}>
                {t('enrichment.source')}
              </Link>
            </Button>
          )}
          <p className="break-words text-xs text-muted-foreground">
            {t('enrichment.policy', { average: record.average.toFixed(2), policy: record.policy })}
          </p>
        </div>
      </ResponsiveDialog>
    </>
  );
}
