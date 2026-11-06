import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Handshake, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Chat } from '@ezychat/shared';
import { Banner, EmptyState, ResponsiveDialog } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  DAY_MS,
  endsSoon,
  startOfToday,
  usePartnerMe,
  usePartnerRows,
  useRemoveShare,
  useSaveShare,
  type PartnerShare,
} from '../mock/partnerRole';

/**
 * Proposed (partner-role): what partners see and what admins use to share one chat.
 * Production: `apps/web/src/inbox/PartnerShare.tsx` on `GET/POST/DELETE /api/chats/:jid/shares`.
 */

export type EndChoice = 'none' | '7' | '30' | '90';

export function endAt(choice: EndChoice): number | null {
  if (choice === 'none') return null;
  const d = new Date(startOfToday() + Number(choice) * DAY_MS);
  d.setHours(23, 59, 0, 0);
  return d.getTime();
}

export function formatDay(ts: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(ts);
}

/** "Ends 12 Nov" / "Ends in 3 days" (warning) / nothing. */
export function ShareBadges({ share, className }: { share: PartnerShare; className?: string }) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const days = share.expiresAt
    ? Math.max(1, Math.ceil((share.expiresAt - Date.now()) / DAY_MS))
    : 0;
  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {share.expiresAt !== null &&
        (endsSoon(share) ? (
          <Badge className="bg-warning/15 text-warning">
            {t('partner.share.endsIn', { count: days })}
          </Badge>
        ) : (
          <Badge variant="secondary">
            {t('partner.share.ends', { date: formatDay(share.expiresAt, i18n.language) })}
          </Badge>
        ))}
      {share.historyFrom !== null && (
        <Badge variant="secondary">
          {t('partner.share.historyFrom', { date: formatDay(share.historyFrom, i18n.language) })}
        </Badge>
      )}
    </span>
  );
}

/** The two choices every share has: an end date and how much history the partner reads. */
export function ShareOptions({
  end,
  onEnd,
  todayOn,
  onTodayOn,
  idPrefix,
}: {
  end: EndChoice;
  onEnd(v: EndChoice): void;
  todayOn: boolean;
  onTodayOn(v: boolean): void;
  idPrefix: string;
}) {
  const { t } = useTranslation(['admin', 'common']);
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-end`}>{t('partner.share.endLabel')}</Label>
        <Select value={end} onValueChange={(v) => onEnd(v as EndChoice)}>
          <SelectTrigger id={`${idPrefix}-end`} className="min-h-11 w-full md:min-h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['none', '7', '30', '90'] as const).map((v) => (
              <SelectItem key={v} value={v} className="min-h-11 md:min-h-8">
                {t(`partner.share.end.${v}` as const)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('partner.share.endHint')}</p>
      </div>
      <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0">
          <Label htmlFor={`${idPrefix}-history`}>{t('partner.share.todayOnLabel')}</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {todayOn ? t('partner.share.todayOnHint') : t('partner.share.fullHistoryHint')}
          </p>
        </div>
        <Switch
          id={`${idPrefix}-history`}
          checked={todayOn}
          onCheckedChange={onTodayOn}
          className="mt-0.5"
        />
      </div>
    </>
  );
}

/** Chat header (admins): who this chat is shared with, add a partner, remove one. */
export function ShareWithPartnerDialog({ chat, onClose }: { chat: Chat; onClose(): void }) {
  const { t } = useTranslation(['admin', 'common']);
  const partners = usePartnerRows();
  const save = useSaveShare();
  const remove = useRemoveShare();
  const current = partners.flatMap((p) =>
    p.shares.filter((s) => s.chatJid === chat.jid).map((s) => ({ share: s, partner: p })),
  );
  const available = partners.filter((p) => !p.shares.some((s) => s.chatJid === chat.jid));
  const [userId, setUserId] = useState<string>('');
  const [end, setEnd] = useState<EndChoice>('none');
  const [todayOn, setTodayOn] = useState(false);
  const picked = userId || (available[0] ? String(available[0].userId) : '');

  const submit = () => {
    if (!picked) return;
    const partner = partners.find((p) => String(p.userId) === picked);
    save.mutate(
      {
        userId: Number(picked),
        chatJid: chat.jid,
        expiresAt: endAt(end),
        historyFrom: todayOn ? startOfToday() : null,
      },
      {
        onSuccess: () => {
          toast.success(t('partner.share.done', { name: partner?.displayName ?? '' }));
          onClose();
        },
      },
    );
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={t('partner.share.title')}
      description={t('partner.share.description')}
      footer={
        partners.length > 0 && available.length > 0 ? (
          <>
            <Button variant="outline" size="touch" className="sm:min-h-9" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button size="touch" className="sm:min-h-9" onClick={submit} disabled={save.isPending}>
              <Handshake aria-hidden />
              {t('partner.share.submit')}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="touch" className="sm:min-h-9" onClick={onClose}>
            {t('common:actions.done')}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 pb-1" data-testid="share-dialog">
        {current.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t('partner.share.sharedWith')}</h3>
            <ul className="divide-y rounded-lg border">
              {current.map(({ share, partner }) => (
                <li key={share.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{partner.displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">{partner.company}</p>
                    <ShareBadges share={share} className="mt-1" />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-touch"
                    aria-label={t('partner.share.removeFor', { name: partner.displayName })}
                    onClick={() =>
                      remove.mutate(share.id, {
                        onSuccess: () =>
                          toast.success(t('partner.share.removed', { name: partner.displayName })),
                      })
                    }
                  >
                    <Trash2 aria-hidden className="text-danger" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {partners.length === 0 ? (
          <EmptyState
            title={t('partner.share.noPartnersTitle')}
            description={t('partner.share.noPartnersBody')}
            action={
              <Button asChild variant="outline" size="touch">
                <Link to="/admin/members">{t('partner.share.invite')}</Link>
              </Button>
            }
          />
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('partner.share.allShared')}</p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="share-partner">{t('partner.share.partnerLabel')}</Label>
              <Select value={picked} onValueChange={setUserId}>
                <SelectTrigger id="share-partner" className="min-h-11 w-full md:min-h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {available.map((p) => (
                    <SelectItem
                      key={p.userId}
                      value={String(p.userId)}
                      className="min-h-11 md:min-h-8"
                    >
                      {p.company ? `${p.displayName} · ${p.company}` : p.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ShareOptions
              end={end}
              onEnd={setEnd}
              todayOn={todayOn}
              onTodayOn={setTodayOn}
              idPrefix="share"
            />
            <Banner tone="info">
              {chat.type === 'group' ? t('partner.share.whatGroup') : t('partner.share.whatDirect')}
            </Banner>
          </>
        )}
      </div>
    </ResponsiveDialog>
  );
}

/** Top of the partner's chat list: whose chats these are and how many. */
export function PartnerBanner() {
  const { t } = useTranslation(['admin', 'common']);
  const me = usePartnerMe();
  if (!me.isPartner) return null;
  return (
    <div className="px-3 pb-2" data-testid="partner-banner">
      <Banner tone="info" title={t('partner.view.bannerTitle', { company: me.company })}>
        {t('partner.view.bannerBody', { count: me.shares.length })}
      </Banner>
    </div>
  );
}

/** A chat that was shared and no longer is (removed or ended): nothing of it stays visible. */
export function NotSharedState({ onBack }: { onBack(): void }) {
  const { t } = useTranslation(['admin', 'inbox']);
  return (
    <EmptyState
      className="flex-1"
      illustration="/illustrations/no-results.png"
      title={t('partner.view.notSharedTitle')}
      description={t('partner.view.notSharedBody')}
      action={
        <Button variant="outline" size="touch" onClick={onBack}>
          {t('inbox:conversation.back')}
        </Button>
      }
    />
  );
}

/** First line of a chat shared "from today on": earlier messages exist but are not shown. */
export function HistoryCutNote({ from }: { from: number }) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  return (
    <p
      className="mx-auto my-2 max-w-sm rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground"
      data-testid="history-cut"
    >
      {t('partner.view.historyCut', { date: formatDay(from, i18n.language) })}
    </p>
  );
}
