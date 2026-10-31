import { useState } from 'react';
import { Ban, Copy, FileWarning, Lock, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Message } from '@ezychat/shared';
import { ApiError, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  useSafetyAction,
  useSafetyDownload,
  useSafetyFlags,
  type MessageFlag,
} from '../mock/safety';

/**
 * Proposed (whatsapp-safety): what the chat shows for a message WhatsApp Safety flagged. A short
 * banner (why, in plain words), the file behind a check before download (locked for agents when
 * the risk is high), and a bar on top of the chat for a reported, blocked or possibly hacked number.
 */
export function useMessageFlag(messageId: string): MessageFlag | null {
  const { data } = useSafetyFlags();
  return data?.enabled ? (data.messages[messageId] ?? null) : null;
}

/** At most two reasons: a critical one first, the rest are on the admin Safety page. */
function topReasons(flag: MessageFlag) {
  return flag.ruleCodes.filter((r) => r !== 'firstFile').slice(0, 2);
}

export function SafetyNotice({ flag, hasFile }: { flag: MessageFlag; hasFile: boolean }) {
  const { t } = useTranslation('inbox');
  if (flag.status === 'safe') return null;
  const high = flag.level === 'high';
  return (
    <div
      role="note"
      data-testid="safety-notice"
      data-level={flag.level}
      className={cn(
        'mb-1.5 flex gap-2 rounded-md border px-2.5 py-2 text-xs',
        high ? 'border-danger/40 bg-danger/10' : 'border-warning/50 bg-warning/10',
      )}
    >
      <ShieldAlert
        className={cn('mt-0.5 size-4 shrink-0', high ? 'text-danger' : 'text-warning')}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="font-semibold">
          {t(`mockSafety.title.${high ? 'high' : 'warning'}.${hasFile ? 'file' : 'text'}`)}
        </p>
        <ul className="mt-0.5 list-disc pl-4 text-muted-foreground">
          {topReasons(flag).map((r) => (
            <li key={r}>{t(`mockSafety.rule.${r}`)}</li>
          ))}
        </ul>
        {flag.ai && flag.ai.level !== 'none' && (
          <p className="mt-1 flex gap-1 text-muted-foreground">
            <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>{t(`mockSafety.ai.${flag.ai.reason}`)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** The flagged file: a check before download, locked for agents while the risk is high. */
export function SafetyFile({ message, flag }: { message: Message; flag: MessageFlag }) {
  const { t } = useTranslation('inbox');
  const { t: tc } = useTranslation('common');
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const download = useSafetyDownload();
  const [open, setOpen] = useState(false);
  const name = message.mediaName ?? t('media.document');
  const high = flag.level === 'high';

  if (flag.deleted)
    return (
      <p
        data-testid="safety-file-deleted"
        className="flex min-h-14 items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground"
      >
        <FileWarning className="size-5 shrink-0" aria-hidden />
        {t('mockSafety.file.deleted', { name: flag.deleted.by })}
      </p>
    );

  const lockedForMe = flag.locked && !admin;
  const save = () =>
    download.mutate(flag.id, {
      onSuccess: () => {
        setOpen(false);
        if (message.mediaUrl) {
          const a = document.createElement('a');
          a.href = message.mediaUrl;
          a.download = name;
          a.click();
        }
      },
      onError: (e) => {
        setOpen(false);
        toast.error(
          e instanceof ApiError && e.status === 403
            ? t('mockSafety.file.lockedToast')
            : errorMessage(e),
        );
      },
    });

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        data-testid="safety-file"
        data-locked={lockedForMe ? 'true' : 'false'}
        onClick={() => (lockedForMe ? save() : setOpen(true))}
        className="flex h-auto min-h-14 w-full max-w-full items-center justify-start gap-3 rounded-lg border bg-muted/60 px-3 py-2 text-left whitespace-normal hover:bg-muted"
      >
        {lockedForMe ? (
          <Lock className="size-7 shrink-0 text-danger" aria-hidden />
        ) : (
          <FileWarning
            className={cn('size-7 shrink-0', high ? 'text-danger' : 'text-warning')}
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            {lockedForMe
              ? t('mockSafety.file.locked')
              : flag.locked
                ? t('mockSafety.file.lockedAdmin')
                : t('mockSafety.file.check')}
          </span>
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="safety-download-dialog">
          <DialogHeader>
            <DialogTitle>
              {t(high ? 'mockSafety.download.highTitle' : 'mockSafety.download.title')}
            </DialogTitle>
            <DialogDescription>
              {t(high ? 'mockSafety.download.highBody' : 'mockSafety.download.body')}
            </DialogDescription>
          </DialogHeader>
          <p className="truncate rounded-md bg-muted px-3 py-2 text-sm">{name}</p>
          <DialogFooter className="gap-2 sm:justify-between">
            {admin ? (
              <Button asChild variant="link" className="px-0">
                <Link to="/admin/safety">{t('mockSafety.download.openReport')}</Link>
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" size="touch" onClick={() => setOpen(false)}>
                {tc('actions.cancel')}
              </Button>
              <Button
                variant={high ? 'destructive' : 'default'}
                size="touch"
                disabled={download.isPending}
                data-testid="safety-download-confirm"
                onClick={save}
              >
                {t('mockSafety.download.confirm')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A bar at the top of the chat: reported, blocked, or a customer whose WhatsApp may be hacked. */
export function SafetyChatBar({ jid }: { jid: string }) {
  const { t } = useTranslation('inbox');
  const { user } = useAuth();
  const { data } = useSafetyFlags();
  const action = useSafetyAction();
  const chat = data?.enabled ? data.chats[jid] : undefined;
  if (!chat || (!chat.blocked && !chat.scam && !chat.maybeHacked)) return null;
  const admin = user?.role === 'admin';

  if (chat.maybeHacked && !chat.blocked)
    return (
      <div
        data-testid="safety-chat-bar"
        data-kind="hacked"
        className="flex flex-wrap items-center gap-2 border-b border-warning/50 bg-warning/10 px-4 py-2 text-sm"
      >
        <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden />
        <span className="min-w-0 flex-1">{t('mockSafety.bar.hacked')}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(t('mockSafety.bar.warnText'))
              .then(() => toast.success(t('mockSafety.bar.copied')))
              .catch(() => toast.error(t('mockSafety.bar.copyFailed')))
          }
        >
          <Copy aria-hidden />
          {t('mockSafety.bar.copyWarning')}
        </Button>
      </div>
    );

  return (
    <div
      data-testid="safety-chat-bar"
      data-kind={chat.blocked ? 'blocked' : 'scam'}
      className="flex flex-wrap items-center gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm"
    >
      {chat.blocked ? (
        <Ban className="size-4 shrink-0 text-danger" aria-hidden />
      ) : (
        <ShieldCheck className="size-4 shrink-0 text-danger" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        {chat.blocked
          ? chat.blocked.auto
            ? t('mockSafety.bar.autoBlocked')
            : t('mockSafety.bar.blocked', { name: chat.blocked.by })
          : t('mockSafety.bar.scam')}
      </span>
      {admin && chat.blocked && (
        <Button
          size="sm"
          variant="outline"
          disabled={action.isPending}
          onClick={() => action.mutate({ id: chat.itemId, action: 'unblock' })}
        >
          {t('mockSafety.bar.unblock')}
        </Button>
      )}
    </div>
  );
}
