import { Download } from 'lucide-react';
import type { AuditEntry, User } from '@wa-team-inbox/shared';
import { useAudit, useUsers } from '../api/queries';
import { formatDateTime } from '../lib/format';
import { EmptyState, PageHeader, ResponsiveTable, type Column } from '@/components/app';
import { Button } from '@/components/ui/button';
import { ErrorState, ListSkeleton, Pending } from './adminUi';

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
  const byId = new Map<number, User>((users.data ?? []).map((u) => [u.id, u]));
  const who = (e: AuditEntry) =>
    e.userId == null ? 'System' : (byId.get(e.userId)?.displayName ?? `User #${e.userId}`);

  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? [];

  const columns: Column<AuditEntry>[] = [
    {
      key: 'time',
      header: 'Time',
      className: 'md:w-44 whitespace-nowrap text-muted-foreground',
      cell: (e) => formatDateTime(e.at),
    },
    { key: 'who', header: 'Who', className: 'md:w-36', cell: (e) => who(e) },
    {
      key: 'action',
      header: 'Action',
      className: 'md:w-44',
      cell: (e) => <span className="font-mono text-xs break-all">{e.action}</span>,
    },
    {
      key: 'details',
      header: 'Details',
      cell: (e) => <span className="break-words text-muted-foreground">{metaSummary(e.meta)}</span>,
    },
    {
      key: 'ip',
      header: 'IP',
      className: 'md:w-32',
      cell: (e) => <span className="font-mono text-xs text-muted-foreground">{e.ip ?? ''}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Sign-ins, member changes, WhatsApp and tunnel actions."
        actions={
          <Button asChild variant="outline" size="touch" className="md:min-h-9">
            <a href="/api/logs/download">
              <Download aria-hidden />
              Download logs
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
            empty={<EmptyState title="No audit entries yet" />}
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
                Load older
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
