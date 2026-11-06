import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ExternalLink, Handshake, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Banner, EmptyState, ResponsiveDialog } from '@/components/app';
import { SearchField } from '@/components/app/SearchField';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useChats } from '../api/queries';
import { encodeJid } from '../lib/jid';
import { ChatAvatar } from '../inbox/ChatAvatar';
import { GroupIcon } from '../inbox/ChatListItem';
import { formatDay } from '../inbox/PartnerShare';
import {
  longListShares,
  usePartnerSettings,
  usePartnerState,
  useRemoveShare,
  useSaveShare,
  type PartnerLogRow,
  type PartnerRow,
  type PartnerShare,
} from '../mock/partnerRole';
import { ConfirmDialog, ErrorState, ListSkeleton } from './adminUi';

/**
 * Proposed (partner-role): Admin → Members → a partner. The chats this partner can see (share, stop
 * sharing; full history, no end date), what partners can and cannot do, and what changed.
 * Production: `apps/web/src/admin/PartnerPage.tsx` on `GET/POST/DELETE /api/users/:id/shares`.
 */
export function PartnerPage() {
  const { userId } = useParams();
  const { t } = useTranslation(['admin', 'common']);
  const q = usePartnerState();
  const partner = q.data?.partners?.find((p) => String(p.userId) === userId);
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!partner) return <Navigate to="/admin/members" replace />;
  return (
    <div className="flex flex-col gap-4" data-testid="partner-page">
      <Button asChild variant="ghost" size="touch" className="-ml-2 self-start md:min-h-9">
        <Link to="/admin/members">
          <ArrowLeft aria-hidden />
          {t('members.title')}
        </Link>
      </Button>
      <div className="flex items-start gap-3">
        <Avatar className="size-12 shrink-0">
          <AvatarFallback className="bg-warning/15 font-semibold text-warning">
            {partner.displayName
              .split(/\s+/)
              .map((w) => w[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">
              {partner.displayName}
            </h1>
            <Badge className="bg-warning/15 text-warning">{t('common:roles.partner')}</Badge>
            <Badge variant="outline">{t('mockSuggest.proposed')}</Badge>
          </div>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {partner.company || t('partner.page.noCompany')}
          </p>
        </div>
      </div>
      <SharedChatsCard partner={partner} longList={!!q.data?.longList} />
      <PartnerCanCard />
      <ActivityCard partner={partner} rows={q.data?.log ?? []} />
      <MockBox partner={partner} longList={!!q.data?.longList} />
    </div>
  );
}

const PAGE = 8;

function SharedChatsCard({ partner, longList }: { partner: PartnerRow; longList: boolean }) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PartnerShare | null>(null);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE * 3);
  const remove = useRemoveShare();
  const rows = useMemo(
    () => [...partner.shares, ...(longList ? longListShares(partner.userId) : [])],
    [partner, longList],
  );
  const q = search.trim().toLocaleLowerCase();
  const shown = rows.filter((s) => !q || s.chatName.toLocaleLowerCase().includes(q));
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{t('partner.page.chatsTitle', { name: partner.displayName })}</CardTitle>
          <CardDescription>{t('partner.page.chatsBody')}</CardDescription>
        </div>
        <Button size="touch" className="md:min-h-9" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          {t('partner.page.add')}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <EmptyState
            illustration="/illustrations/empty-inbox.png"
            title={t('partner.page.emptyTitle')}
            description={t('partner.page.emptyBody', { name: partner.displayName })}
          />
        ) : (
          <>
            {rows.length > PAGE && (
              <SearchField
                value={search}
                onChange={setSearch}
                label={t('partner.page.searchLabel')}
                placeholder={t('partner.page.searchPlaceholder')}
              />
            )}
            <p role="status" className="text-sm text-muted-foreground">
              {t('partner.page.count', { shown: shown.length, count: rows.length })}
            </p>
            <ul className="divide-y rounded-lg border" data-testid="shared-chats">
              {shown.slice(0, limit).map((s) => (
                <li key={s.id} className="flex items-start gap-3 px-3 py-2.5">
                  <ChatAvatar name={s.chatName} seed={s.chatJid} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-1 font-medium">
                      {s.chatType === 'group' && (
                        <GroupIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="[overflow-wrap:anywhere] md:truncate">{s.chatName}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('partner.page.sharedOn', {
                        date: formatDay(s.grantedAt, i18n.language),
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    {!s.id.startsWith('long-') && (
                      <Button
                        asChild
                        variant="ghost"
                        size="icon-touch"
                        aria-label={t('partner.page.open', { name: s.chatName })}
                      >
                        <Link to={`/chats/${encodeJid(s.chatJid)}`}>
                          <ExternalLink aria-hidden />
                        </Link>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-touch"
                      aria-label={t('partner.page.remove', { name: s.chatName })}
                      onClick={() => setRemoving(s)}
                    >
                      <Trash2 aria-hidden className="text-danger" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {shown.length > limit && (
              <Button
                variant="outline"
                size="touch"
                className="self-start md:min-h-9"
                onClick={() => setLimit((l) => l + PAGE * 3)}
              >
                {t('partner.page.showMore', { count: shown.length - limit })}
              </Button>
            )}
          </>
        )}
      </CardContent>
      {adding && <AddChatDialog partner={partner} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={!!removing}
        danger
        title={t('partner.page.removeTitle', { chat: removing?.chatName ?? '' })}
        confirmLabel={t('partner.page.removeConfirm')}
        loading={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          if (removing.id.startsWith('long-')) return setRemoving(null);
          remove.mutate(removing.id, {
            onSuccess: () => {
              toast.success(t('partner.share.removed', { name: partner.displayName }));
              setRemoving(null);
            },
          });
        }}
      >
        <p>{t('partner.page.removeBody', { name: partner.displayName })}</p>
      </ConfirmDialog>
    </Card>
  );
}

function AddChatDialog({ partner, onClose }: { partner: PartnerRow; onClose(): void }) {
  const { t } = useTranslation(['admin', 'common']);
  const open = useChats({ assigned: 'any', status: 'open' });
  const done = useChats({ assigned: 'any', status: 'resolved' });
  const save = useSaveShare();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const shared = new Set(partner.shares.map((s) => s.chatJid));
  const chats = [...(open.data?.pages ?? []), ...(done.data?.pages ?? [])]
    .flatMap((p) => p.chats)
    .filter((c) => !shared.has(c.jid));
  const q = search.trim().toLocaleLowerCase();
  const list = chats.filter((c) => !q || (c.name ?? '').toLocaleLowerCase().includes(q));
  const submit = () => {
    if (!picked) return;
    save.mutate(
      {
        userId: partner.userId,
        chatJid: picked,
      },
      {
        onSuccess: () => {
          toast.success(t('partner.share.done', { name: partner.displayName }));
          onClose();
        },
      },
    );
  };
  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={t('partner.page.addTitle', { name: partner.displayName })}
      description={t('partner.page.addBody')}
      footer={
        <>
          <Button variant="outline" size="touch" className="sm:min-h-9" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            size="touch"
            className="sm:min-h-9"
            onClick={submit}
            disabled={!picked || save.isPending}
          >
            <Handshake aria-hidden />
            {t('partner.share.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-1" data-testid="add-chat-dialog">
        <SearchField
          value={search}
          onChange={setSearch}
          label={t('partner.page.pickLabel')}
          placeholder={t('partner.page.pickPlaceholder')}
        />
        <ul
          className="max-h-56 divide-y overflow-y-auto rounded-lg border"
          aria-label={t('partner.page.pickLabel')}
        >
          {list.length === 0 && (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              {t('partner.page.pickNone')}
            </li>
          )}
          {list.map((c) => (
            <li key={c.jid}>
              <Button
                type="button"
                variant="ghost"
                aria-pressed={picked === c.jid}
                onClick={() => setPicked(c.jid)}
                className={cn(
                  'h-auto min-h-11 w-full justify-start gap-3 rounded-none px-3 py-2 text-left font-normal',
                  picked === c.jid && 'bg-accent text-accent-foreground',
                )}
              >
                <ChatAvatar name={c.name ?? c.jid} seed={c.jid} size="sm" />
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  {c.type === 'group' && (
                    <GroupIcon className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{c.name || c.jid}</span>
                </span>
                {picked === c.jid && <Check aria-hidden className="text-primary" />}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </ResponsiveDialog>
  );
}

function PartnerCanCard() {
  const { t } = useTranslation(['admin', 'common']);
  const can = ['read', 'reply', 'suggest', 'takeOver', 'assignSelf'] as const;
  const cannot = [
    'newChats',
    'otherChats',
    'notes',
    'numbers',
    'admin',
    'askEzy',
    'export',
  ] as const;
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>{t('partner.can.title')}</CardTitle>
        <CardDescription>{t('partner.can.body')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm md:grid-cols-2">
        <ul className="flex flex-col gap-2">
          {can.map((k) => (
            <li key={k} className="flex items-start gap-2">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              {t(`partner.can.yes.${k}`)}
            </li>
          ))}
        </ul>
        <ul className="flex flex-col gap-2">
          {cannot.map((k) => (
            <li key={k} className="flex items-start gap-2 text-muted-foreground">
              <X aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
              {t(`partner.can.no.${k}`)}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ActivityCard({ partner, rows }: { partner: PartnerRow; rows: PartnerLogRow[] }) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const mine = rows.filter((r) => r.partner === partner.displayName);
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>{t('partner.activity.title')}</CardTitle>
        <CardDescription>{t('partner.activity.body')}</CardDescription>
      </CardHeader>
      <CardContent>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('partner.activity.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {mine.slice(0, 10).map((r, i) => (
              <li key={`${r.at}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                <time className="w-28 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatDay(r.at, i18n.language)}
                </time>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {(t as unknown as (k: string, o: object) => string)(
                    `partner.activity.${r.action.replace('.', '_')}`,
                    {
                      by: r.by,
                      partner: r.partner,
                      chat: r.chat ?? '',
                    },
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MockBox({ partner, longList }: { partner: PartnerRow; longList: boolean }) {
  const { t } = useTranslation(['admin', 'common']);
  const settings = usePartnerSettings();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-3">
      <Badge variant="outline" className="self-start">
        {t('mockSuggest.mockControls')}
      </Badge>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Button
          variant="link"
          className="h-auto p-0"
          onClick={() => settings.mutate({ longList: !longList })}
        >
          {longList ? t('partner.mock.shortList') : t('partner.mock.longList')}
        </Button>
      </div>
      <Banner tone="info">{t('partner.mock.signIn')}</Banner>
    </div>
  );
}
