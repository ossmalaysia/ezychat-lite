import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEnrichment, useSaveEnrichment } from '../api/enrichment';
import { errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ErrorState, ListSkeleton, Pending, SaveBar } from './adminUi';

export function CustomerEnrichmentSection() {
  const { t } = useTranslation('admin');
  const id = useId();
  const query = useEnrichment();
  const save = useSaveEnrichment();
  const [draft, setDraft] = useState<boolean>();
  const enabled = draft ?? query.data?.enabled ?? false;
  const dirty = draft !== undefined && draft !== query.data?.enabled;
  const header = (
    <CardHeader>
      <CardTitle>{t('enrichment.title')}</CardTitle>
      <CardDescription>{t('enrichment.description')}</CardDescription>
    </CardHeader>
  );
  if (!query.data)
    return (
      <Card>
        {header}
        <CardContent>
          {query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <ListSkeleton rows={2} />
          )}
        </CardContent>
      </Card>
    );
  return (
    <Card>
      {header}
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor={id}>{t('enrichment.enable')}</Label>
            <p className="mt-1 text-sm text-muted-foreground">{t('enrichment.independent')}</p>
          </div>
          <Label
            htmlFor={id}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
          >
            <Switch
              id={id}
              checked={enabled}
              onCheckedChange={setDraft}
              disabled={save.isPending}
            />
          </Label>
        </div>
        {enabled && !query.data.connected && (
          <Banner tone="warning">{t('enrichment.paused')}</Banner>
        )}
        <p className="text-sm text-muted-foreground">{t('enrichment.thresholds')}</p>
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-sm text-primary">
            {t('enrichment.rules')}
          </summary>
          <p className="text-sm text-muted-foreground">{t('enrichment.weights')}</p>
        </details>
        {(save.error || query.error) && (
          <Banner tone="danger">{errorMessage(save.error || query.error)}</Banner>
        )}
        <SaveBar dirty={dirty}>
          <Button
            size="touch"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(enabled, { onSuccess: () => setDraft(undefined) })}
          >
            <Pending show={save.isPending} />
            {t('settings.save')}
          </Button>
        </SaveBar>
        <div className="border-t pt-4">
          <Button asChild variant="link" size="touch">
            <Link to="/admin/audit">{t('enrichment.audit')}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
