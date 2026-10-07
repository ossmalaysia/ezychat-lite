import { useId, useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AuditEntry, User } from '@wa-team-inbox/shared';
import { useAudit, useUsers } from '../api/queries';
import { formatDateTime } from '../lib/format';
import {
  EmptyState,
  PageHeader,
  ResponsiveTable,
  SegmentedControl,
  type Column,
} from '@/components/app';
import { Button } from '@/components/ui/button';
import { ErrorState, ListSkeleton, Pending } from './adminUi';
import { auditActionLabel, auditDetails, isSignInAction } from './audit-actions';

type AuditFilter = 'all' | 'changes';

export function AuditPage() {
  const audit = useAudit();
  const users = useUsers();
  const { t } = useTranslation(['admin', 'common']);
  const filterLabelId = useId();
  const [filter, setFilter] = useState<AuditFilter>('all');
  const byId = new Map<number, User>((users.data ?? []).map((u) => [u.id, u]));
  const userName = (id: number) => byId.get(id)?.displayName;
  const who = (e: AuditEntry) =>
    e.userId == null
      ? t('audit.system')
      : (userName(e.userId) ?? t('audit.userNumber', { id: e.userId }));
  const details = (e: AuditEntry) => auditDetails(e.meta, t, userName);

  const loaded = audit.data?.pages.flatMap((p) => p.entries) ?? [];
  const entries = filter === 'all' ? loaded : loaded.filter((e) => !isSignInAction(e.action));
  const hidden = loaded.length - entries.length;

  const columns: Column<AuditEntry>[] = [
    {
      key: 'time',
      header: t('audit.columns.time'),
      className: 'md:w-44 whitespace-nowrap text-muted-foreground',
      cell: (e) => formatDateTime(e.at),
    },
    { key: 'who', header: t('audit.columns.who'), className: 'md:w-36', cell: (e) => who(e) },
    {
      key: 'action',
      header: t('audit.columns.action'),
      // Wrap between words, never inside one (the table cell otherwise breaks anywhere).
      className: 'md:w-48 [overflow-wrap:break-word]',
      cell: (e) => (
        <span title={e.action} className="font-medium break-words">
          {auditActionLabel(e.action, t)}
        </span>
      ),
    },
    {
      key: 'details',
      header: t('audit.columns.details'),
      hideOnMobileFor: (e) => details(e) === '',
      cell: (e) => <span className="break-words text-muted-foreground">{details(e)}</span>,
    },
    {
      key: 'ip',
      header: t('audit.columns.ip'),
      className: 'md:w-32',
      cell: (e) => <span className="font-mono text-xs text-muted-foreground">{e.ip ?? ''}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('audit.title')}
        description={t('audit.description')}
        actions={
          <Button asChild variant="outline" size="touch" className="md:min-h-9">
            <a href="/api/logs/download">
              <Download aria-hidden />
              {t('audit.download')}
            </a>
          </Button>
        }
      />

      {audit.isPending ? (
        <ListSkeleton rows={6} />
      ) : audit.isError ? (
        <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span id={filterLabelId} className="text-sm text-muted-foreground">
              {t('audit.filterLabel')}
            </span>
            <SegmentedControl
              aria-labelledby={filterLabelId}
              value={filter}
              onValueChange={setFilter}
              options={[
                { value: 'all', label: t('audit.filterAll') },
                { value: 'changes', label: t('audit.filterChanges') },
              ]}
            />
            {hidden > 0 && (
              <p role="status" className="text-sm text-muted-foreground">
                {t('audit.hiddenSignIns', { count: hidden })}
              </p>
            )}
          </div>
          <ResponsiveTable
            rows={entries}
            columns={columns}
            rowKey={(e) => e.id}
            empty={<EmptyState title={t('audit.empty')} />}
          />
          {audit.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="touch"
                className="md:min-h-9"
                onClick={() => void audit.fetchNextPage()}
                disabled={audit.isFetchingNextPage}
              >
                <Pending show={audit.isFetchingNextPage} />
                {t('audit.loadOlder')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
