import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Handshake, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Chat } from '@ezychat/shared';
import { Banner, EmptyState, ResponsiveDialog } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
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

export function formatDay(ts: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(ts);
}

/** "Shared 1 Nov 2026 by Aisyah"-style line under a shared chat or partner. */
export function SharedOn({ share, className }: { share: PartnerShare; className?: string }) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      {t('partner.page.sharedOn', { date: formatDay(share.grantedAt, i18n.language) })}
    </p>
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
  const picked = userId || (available[0] ? String(available[0].userId) : '');

  const submit = () => {
    if (!picked) return;
    const partner = partners.find((p) => String(p.userId) === picked);
    save.mutate(
      {
        userId: Number(picked),
        chatJid: chat.jid,
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
                    <SharedOn share={share} className="mt-0.5" />
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
