import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Inbox, User } from '@ezychat/shared';
import { errorMessage } from '../api/client';
import { useSetUserInboxes } from '../api/inbox-mutations';
import { InboxChip } from '../inbox/InboxChip';
import { Banner, ResponsiveDialog } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { formatInboxNumber } from './inbox-status';

/**
 * Members → Inbox access: which inboxes a member may open. Admins always see every inbox; an agent
 * sees only the chats (and notifications) of the inboxes ticked here. `inboxes` are the active ones.
 */
export function InboxAccessCell({ user, inboxes }: Readonly<{ user: User; inboxes: Inbox[] }>) {
  const { t } = useTranslation('admin');
  const [editing, setEditing] = useState(false);
  if (user.kind === 'ai') return <span className="text-sm text-muted-foreground">—</span>;
  if (user.role === 'admin')
    return <span className="text-sm text-muted-foreground">{t('inboxes.membersAccessAll')}</span>;
  const ids = user.inboxIds ?? [];
  const mine = inboxes.filter((i) => ids.includes(i.id));
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="inbox-access">
      {mine.length === 0 ? (
        <span className="text-sm text-warning">{t('inboxes.membersAccessNone')}</span>
      ) : (
        mine.map((i) => <InboxChip key={i.id} inbox={i} />)
      )}
      <Button
        type="button"
        variant="ghost"
        size="touch"
        className="px-2 md:min-h-8"
        aria-label={t('inboxes.membersAccessTitle', { name: user.displayName })}
        onClick={() => setEditing(true)}
      >
        {t('inboxes.edit')}
      </Button>
      <InboxAccessDialog
        user={user}
        inboxes={inboxes}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </div>
  );
}

function InboxAccessDialog({
  user,
  inboxes,
  open,
  onClose,
}: Readonly<{ user: User; inboxes: Inbox[]; open: boolean; onClose: () => void }>) {
  const { t } = useTranslation(['admin', 'common']);
  const save = useSetUserInboxes(user.id);
  const [picked, setPicked] = useState<number[]>([]);
  useEffect(() => {
    if (!open) return;
    setPicked(user.inboxIds ?? []);
    save.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: number, on: boolean) =>
    setPicked((p) => (on ? [...new Set([...p, id])] : p.filter((x) => x !== id)));
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('inboxes.membersAccessTitle', { name: user.displayName })}
      description={t('inboxes.membersAccessDescription')}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="sm:min-h-9"
            onClick={onClose}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            type="button"
            size="touch"
            className="sm:min-h-9"
            disabled={save.isPending}
            aria-busy={save.isPending}
            onClick={() =>
              // Only active inboxes can be ticked; the server keeps no access to removed ones.
              save.mutate(
                picked.filter((id) => inboxes.some((i) => i.id === id)),
                {
                  onSuccess: () => {
                    toast.success(t('inboxes.membersAccessSaved'));
                    onClose();
                  },
                },
              )
            }
          >
            {t('inboxes.membersAccessSave')}
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-3 pb-1">
        {inboxes.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('inboxes.membersAccessNoInboxes')}</p>
        )}
        {inboxes.map((inbox) => {
          const id = `access-${user.id}-${inbox.id}`;
          return (
            <div key={inbox.id} className="flex min-h-11 items-center gap-3 md:min-h-8">
              <Checkbox
                id={id}
                checked={picked.includes(inbox.id)}
                onCheckedChange={(v) => toggle(inbox.id, v === true)}
              />
              <Label htmlFor={id} className="flex min-w-0 flex-wrap items-center gap-2 font-normal">
                <InboxChip inbox={inbox} />
                {inbox.number && (
                  <span className="text-sm break-all text-muted-foreground tabular-nums">
                    {formatInboxNumber(inbox.number)}
                  </span>
                )}
              </Label>
            </div>
          );
        })}
        {save.error && <Banner tone="danger">{errorMessage(save.error)}</Banner>}
      </div>
    </ResponsiveDialog>
  );
}
