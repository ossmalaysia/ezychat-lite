import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AuditEntry, User } from '@wa-team-inbox/shared';
import { useAudit, useUsers } from '../api/queries';
import { formatDateTime } from '../lib/format';
import { EmptyState, PageHeader, ResponsiveTable, type Column } from '@/components/app';
import { Button } from '@/components/ui/button';
import { ErrorState, ListSkeleton, Pending } from './adminUi';
import { auditActionLabel } from './audit-actions';

function metaSummary(meta: Record<string, unknown>): string {
  const parts = Object.entries(meta).map(([k, v]) => {
    const val = typeof v === 'string' ? v : JSON.stringify(v);
    return `${k}: ${val}`;
  });
  return parts.join(', ');
}

export function AuditPage() {
  const audit = useAudit();
  const users = useUsers();
  const { t } = useTranslation('admin');
  const byId = new Map<number, User>((users.data ?? []).map((u) => [u.id, u]));
  const who = (e: AuditEntry) =>
    e.userId == null
      ? t('audit.system')
      : (byId.get(e.userId)?.displayName ?? t('audit.userNumber', { id: e.userId }));

  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? [];

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
      className: 'md:w-44',
      cell: (e) => (
        <span title={e.action} className="font-medium">
          {auditActionLabel(e.action, t)}
        </span>
      ),
    },
    {
      key: 'details',
      header: t('audit.columns.details'),
      cell: (e) => <span className="break-words text-muted-foreground">{metaSummary(e.meta)}</span>,
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
