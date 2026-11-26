import type React from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import type { Message } from '@ezychat/shared';
import { api, errorMessage } from '../api/client';
import { Banner, ResponsiveDialog } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateTime, truncate } from '../lib/format';

/**
 * Proposed (history-and-message-info, owner 2026-11-26): **Message info** for a message the team
 * sent. Direct chat: Sent, Delivered, Read with their times. Group: who read it and who has it,
 * each with a time. A status WhatsApp reported without a time (messages from the history import)
 * says "Yes, time not known"; a time is never made up. The future route is
 * `GET /api/messages/:id/info`; this mock reads `/api/mock/message-info/:id`.
 */

interface Stamp {
  done: boolean;
  at: number | null;
}
interface MemberReceipt {
  name: string;
  delivered: Stamp;
  read: Stamp;
}
interface MessageInfo {
  status: Message['status'];
  sent: Stamp;
  delivered: Stamp;
  read: Stamp;
  members: MemberReceipt[] | null;
}

const SCENARIOS = [
  'auto',
  'allTimes',
  'readNoTime',
  'sentOnly',
  'pending',
  'failed',
  'groupSeveral',
  'groupLongNames',
  'groupNoneYet',
] as const;

function StampText({ stamp }: Readonly<{ stamp: Stamp }>) {
  const { t } = useTranslation('inbox');
  if (!stamp.done) return <span className="text-muted-foreground">{t('mockInfo.notYet')}</span>;
  if (stamp.at === null)
    return <span className="text-muted-foreground">{t('mockInfo.timeNotKnown')}</span>;
  return (
    <time dateTime={new Date(stamp.at).toISOString()} className="tabular-nums">
      {formatDateTime(stamp.at)}
    </time>
  );
}

function Row({
  icon,
  label,
  stamp,
}: Readonly<{ icon: React.ReactNode; label: string; stamp: Stamp }>) {
  return (
    <div className="flex min-h-11 items-center gap-3 py-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <dt className="min-w-0 flex-1 font-medium">{label}</dt>
      <dd className="text-right text-sm">
        <StampText stamp={stamp} />
      </dd>
    </div>
  );
}

function MemberList({
  title,
  members,
  pick,
  icon,
}: Readonly<{
  title: string;
  members: MemberReceipt[];
  pick(m: MemberReceipt): Stamp;
  icon: React.ReactNode;
}>) {
  if (members.length === 0) return null;
  return (
    <section className="flex flex-col">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </h3>
      <ul className="mt-1 divide-y">
        {members.map((m) => (
          <li key={m.name} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
            <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{m.name}</span>
            <span className="text-sm">
              <StampText stamp={pick(m)} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MessageInfoDialog({
  message,
  open,
  onClose,
}: Readonly<{ message: Message; open: boolean; onClose(): void }>) {
  const { t } = useTranslation(['inbox', 'common']);
  const qc = useQueryClient();
  const info = useQuery({
    queryKey: ['mock-message-info', message.id],
    queryFn: () => api<MessageInfo>(`/mock/message-info/${encodeURIComponent(message.id)}`),
    enabled: open,
  });
  const scenario = useQuery({
    queryKey: ['mock-message-info-scenario'],
    queryFn: () => api<{ scenario: string }>('/mock/message-info/scenario'),
    enabled: open,
  });
  const setScenario = useMutation({
    mutationFn: (next: string) =>
      api('/mock/message-info/scenario', { method: 'PUT', body: { scenario: next } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mock-message-info-scenario'] });
      void qc.invalidateQueries({ queryKey: ['mock-message-info'] });
    },
  });

  const d = info.data;
  const preview =
    message.body?.trim() ||
    (message.mediaName ?? t(`mockInfo.kind.${message.type === 'text' ? 'text' : 'file'}`));

  let content: React.ReactNode;
  if (info.isPending) {
    content = (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  } else if (info.isError || !d) {
    content = <Banner tone="danger">{errorMessage(info.error)}</Banner>;
  } else if (d.status === 'failed') {
    content = (
      <Banner tone="danger" title={t('mockInfo.failedTitle')}>
        {t('mockInfo.failedBody')}
      </Banner>
    );
  } else if (d.status === 'pending') {
    content = (
      <Banner tone="info" title={t('mockInfo.pendingTitle')}>
        {t('mockInfo.pendingBody')}
      </Banner>
    );
  } else if (d.members) {
    const read = d.members.filter((m) => m.read.done);
    const delivered = d.members.filter((m) => !m.read.done && m.delivered.done);
    const waiting = d.members.filter((m) => !m.read.done && !m.delivered.done);
    content = (
      <div className="flex flex-col gap-4">
        <dl className="divide-y">
          <Row icon={<Check className="size-4" />} label={t('mockInfo.sent')} stamp={d.sent} />
        </dl>
        {read.length + delivered.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('mockInfo.noneYet')}</p>
        )}
        <MemberList
          title={t('mockInfo.readBy', { count: read.length })}
          members={read}
          pick={(m) => m.read}
          icon={<CheckCheck className="size-4 text-primary" aria-hidden="true" />}
        />
        <MemberList
          title={t('mockInfo.deliveredTo', { count: delivered.length })}
          members={delivered}
          pick={(m) => m.delivered}
          icon={<CheckCheck className="size-4 text-muted-foreground" aria-hidden="true" />}
        />
        <MemberList
          title={t('mockInfo.waitingFor', { count: waiting.length })}
          members={waiting}
          pick={(m) => m.delivered}
          icon={<Clock className="size-4 text-muted-foreground" aria-hidden="true" />}
        />
        <p className="text-xs text-muted-foreground">{t('mockInfo.groupNote')}</p>
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-3">
        <dl className="divide-y">
          <Row icon={<Check className="size-4" />} label={t('mockInfo.sent')} stamp={d.sent} />
          <Row
            icon={<CheckCheck className="size-4" />}
            label={t('mockInfo.delivered')}
            stamp={d.delivered}
          />
          <Row
            icon={<CheckCheck className="size-4 text-primary" />}
            label={t('mockInfo.read')}
            stamp={d.read}
          />
        </dl>
        <p className="text-xs text-muted-foreground">{t('mockInfo.directNote')}</p>
      </div>
    );
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('mockInfo.title')}
      footer={
        <Button variant="outline" size="touch" className="sm:min-h-9" onClick={onClose}>
          {t('common:actions.close')}
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-4" data-testid="message-info">
        <blockquote
          className={cn(
            'rounded-lg border-l-2 border-primary/50 bg-muted/60 px-3 py-2 text-sm break-words [overflow-wrap:anywhere]',
          )}
        >
          {truncate(preview, 160)}
        </blockquote>
        {content}
        {/* Mock only: pick what WhatsApp reported, to see every state. */}
        <div
          className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2 text-sm"
          data-testid="message-info-mock"
        >
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <AlertCircle className="size-3.5" aria-hidden="true" />
            {t('mockInfo.mockOnly')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {SCENARIOS.map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={scenario.data?.scenario === s ? 'default' : 'outline'}
                className="h-auto min-h-9 px-2 py-1 text-xs"
                aria-pressed={scenario.data?.scenario === s}
                onClick={() => setScenario.mutate(s)}
              >
                {t(`mockInfo.scenario.${s}`)}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
