import type { AuditEntry, User } from '@wa-team-inbox/shared';
import { useAudit, useUsers } from '../api/queries';
import { Button, Spinner } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { ErrorState, PageHeader } from './adminUi';

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

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Sign-ins, member changes, WhatsApp and tunnel actions."
        actions={
          <a
            href="/api/logs/download"
            className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium hover:bg-neutral-50 sm:min-h-9 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          >
            Download logs
          </a>
        }
      />

      {audit.isPending ? (
        <div className="flex justify-center py-10 text-emerald-600">
          <Spinner className="size-6" />
        </div>
      ) : audit.isError ? (
        <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
      ) : entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">No audit entries yet.</p>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-neutral-200 bg-white md:block dark:border-neutral-800 dark:bg-neutral-900">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-950/40 dark:text-neutral-400">
                <tr>
                  <th className="w-44 px-4 py-3 font-medium">Time</th>
                  <th className="w-36 px-4 py-3 font-medium">Who</th>
                  <th className="w-44 px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                  <th className="w-32 px-4 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2.5 text-neutral-500">{formatDateTime(e.at)}</td>
                    <td className="truncate px-4 py-2.5">{who(e)}</td>
                    <td className="truncate px-4 py-2.5 font-mono text-xs">{e.action}</td>
                    <td className="break-words px-4 py-2.5 text-neutral-600 dark:text-neutral-400">
                      {metaSummary(e.meta)}
                    </td>
                    <td className="truncate px-4 py-2.5 font-mono text-xs text-neutral-500">
                      {e.ip ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {entries.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-xs font-semibold">{e.action}</span>
                  <span className="text-xs text-neutral-500">{formatDateTime(e.at)}</span>
                </div>
                <p className="mt-1">
                  {who(e)}
                  {e.ip && <span className="ml-2 font-mono text-xs text-neutral-500">{e.ip}</span>}
                </p>
                {Object.keys(e.meta).length > 0 && (
                  <p className="mt-1 break-words text-neutral-600 dark:text-neutral-400">
                    {metaSummary(e.meta)}
                  </p>
                )}
              </li>
            ))}
          </ul>

          {audit.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void audit.fetchNextPage()}
                loading={audit.isFetchingNextPage}
              >
                Load older
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
