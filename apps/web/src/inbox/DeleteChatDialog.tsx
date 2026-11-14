import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Banner } from '@/components/app';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { errorMessage } from '../api/client';
import { useChatDeletePreview, useDeleteChat } from '../api/chat-delete';

/**
 * Delete chat (admins; docs/features/chat-hide-delete/design.md Part B): the chat's name, what goes
 * (messages and files) and that the WhatsApp phone keeps its copy. Stays open until the server
 * answers; on success the chat leaves every list and `onDeleted` takes the page back to the inbox.
 */
export function DeleteChatDialog({
  jid,
  name,
  open,
  onClose,
  onDeleted,
}: {
  jid: string;
  name: string;
  open: boolean;
  onClose(): void;
  onDeleted(): void;
}) {
  const { t } = useTranslation(['inbox', 'common']);
  const preview = useChatDeletePreview(jid, open);
  const del = useDeleteChat();
  const { reset } = del;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);
  const counts = preview.data
    ? `${t('deleteChat.messages', { count: preview.data.messages })}, ${t('deleteChat.files', { count: preview.data.files })}`
    : null;
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('deleteChat.title')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p data-testid="delete-chat-summary">
                <strong className="font-semibold [overflow-wrap:anywhere] text-foreground">
                  {name}
                </strong>
                {counts && ` · ${counts}`}
              </p>
              <p>{t('deleteChat.body')}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {del.isError && (
          <Banner tone="danger">
            {del.error ? errorMessage(del.error) : t('deleteChat.failed')}
          </Banner>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11 sm:min-h-9" disabled={del.isPending}>
            {t('common:actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="min-h-11 sm:min-h-9"
            disabled={del.isPending}
            onClick={(e) => {
              // Stay open until the server answers.
              e.preventDefault();
              del.mutate(jid, {
                onSuccess: () => {
                  toast.success(t('deleteChat.done'));
                  onDeleted();
                },
              });
            }}
          >
            {del.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {t('deleteChat.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
