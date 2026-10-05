import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import type { Message } from '@wa-team-inbox/shared';
import { ApiError } from '../api/client';
import {
  flattenMessages,
  newClientId,
  qk,
  useChat,
  useMarkRead,
  useMessages,
  useNotes,
  usePatchChat,
  useQuickReplies,
  useRetryMessage,
  useSendMedia,
  useSendText,
  useSendVoice,
  useWaStatus,
  type MessagesData,
} from '../api/queries';
import { useRealtime } from '../api/socket';
import { i18n } from '@/i18n';
import { toast } from 'sonner';
import { EmptyState } from '@/components/app';
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
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Composer } from './Composer';
import { ConversationHeader } from './ConversationHeader';
import { chatTitle } from './chat-title';
import { MessageList } from './MessageList';
import { NotesPanel } from './NotesPanel';
import { buildTimeline } from './timeline';
import { TypingIndicator } from './TypingIndicator';
import type { Directory } from './useDirectory';
import { waQueuesMessages, waSendingBlocked } from './WaBanner';

export interface ConversationProps {
  jid: string;
  directory: Directory;
  onBack(): void;
}

function toastError(e: unknown) {
  toast.error(e instanceof Error ? e.message : i18n.t('inbox:conversation.updateFailed'));
}

/** Chats where the user already agreed to reply despite another assignee (this session). */
const confirmedChats = new Set<string>();

export function Conversation({ jid, directory, onBack }: ConversationProps) {
  const { t } = useTranslation(['inbox', 'common']);
  const qc = useQueryClient();
  const chatQ = useChat(jid);
  const messagesQ = useMessages(jid);
  const notesQ = useNotes(jid);
  const quickReplies = useQuickReplies();
  const wa = useWaStatus();
  const sendText = useSendText(jid);
  const sendMedia = useSendMedia(jid);
  const sendVoice = useSendVoice(jid);
  const retry = useRetryMessage();
  const markRead = useMarkRead(jid);
  const patch = usePatchChat(jid);
  const { typing, emitTyping } = useRealtime();
  const [notesOpen, setNotesOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ name: string; resolve(ok: boolean): void } | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const chat = chatQ.data?.chat;
  const events = chatQ.data?.events;
  const me = directory.me;

  const messages = useMemo(
    () => flattenMessages(messagesQ.data as MessagesData | undefined),
    [messagesQ.data],
  );
  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const notes = notesQ.data;
  const items = useMemo(
    () => buildTimeline(messages, events ?? [], notes ?? []),
    [messages, events, notes],
  );

  // Mark read on open and whenever a new inbound message arrives while viewing.
  const lastInboundId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && !m.fromMe) return m.id;
    }
    return null;
  }, [messages]);
  const lastMarked = useRef<string | null | undefined>(undefined);
  const unread = chat?.unreadCount ?? 0;
  const { mutate: doMarkRead } = markRead;
  useEffect(() => {
    if (!chat) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (lastMarked.current === lastInboundId && unread === 0) return;
    lastMarked.current = lastInboundId;
    doMarkRead();
  }, [chat, lastInboundId, unread, doMarkRead]);

  // Re-mark when the tab becomes visible again.
  useEffect(() => {
    const onVis = () => {
      if (
        document.visibilityState === 'visible' &&
        (qc.getQueryData<{ chat: { unreadCount: number } }>(qk.chat(jid))?.chat.unreadCount ?? 0) >
          0
      )
        doMarkRead();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [qc, jid, doMarkRead]);

  const confirmSend = useCallback((): Promise<boolean> | boolean => {
    if (!chat || chat.assignedTo == null || chat.assignedTo === me?.id) return true;
    if (confirmedChats.has(jid)) return true;
    const name = directory.nameOf(chat.assignedTo) ?? t('conversation.someoneElse');
    return new Promise<boolean>((resolve) => setConfirm({ name, resolve }));
  }, [chat, me?.id, jid, directory, t]);

  function closeConfirm(ok: boolean) {
    if (ok) confirmedChats.add(jid);
    confirm?.resolve(ok);
    setConfirm(null);
  }

  function onRetry(m: Message) {
    setRetryingId(m.id);
    retry.mutate(m.id, {
      onError: (e) => {
        // The optimistic row never reached the server: resend it as a new message.
        if (
          e instanceof ApiError &&
          e.status === 404 &&
          m.id.startsWith('local-') &&
          m.type === 'text' &&
          m.body
        ) {
          qc.setQueryData<MessagesData>(qk.messages(jid), (old) =>
            old
              ? {
                  ...old,
                  pages: old.pages.map((p) => ({
                    ...p,
                    messages: p.messages.filter((x) => x.id !== m.id),
                  })),
                }
              : old,
          );
          sendText.mutate({
            text: m.body,
            quotedId: m.quotedId ?? undefined,
            clientId: newClientId(),
          });
        } else {
          toast.error(e instanceof Error ? e.message : t('conversation.retryFailed'));
        }
      },
      onSettled: () => setRetryingId(null),
    });
  }

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = messagesQ;
  const loadOlder = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (chatQ.isPending) {
    return (
      <div className="flex flex-1 flex-col" role="status" aria-label={t('conversation.loading')}>
        <div className="flex items-center gap-3 border-b bg-surface px-3 py-2">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <Skeleton className="h-12 w-2/3 rounded-2xl" />
          <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
          <Skeleton className="h-8 w-3/5 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (chatQ.isError || !chat) {
    const notFound = chatQ.error instanceof ApiError && chatQ.error.status === 404;
    return (
      <EmptyState
        className="flex-1"
        illustration="/illustrations/no-results.png"
        title={notFound ? t('conversation.notFound') : t('conversation.loadFailed')}
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="touch" onClick={onBack}>
              {t('conversation.back')}
            </Button>
            {!notFound && (
              <Button size="touch" onClick={() => void chatQ.refetch()}>
                {t('common:actions.tryAgain')}
              </Button>
            )}
          </div>
        }
      />
    );
  }

  const waState = wa.data?.state;
  const blocked = waSendingBlocked(waState);
  const queued = waQueuesMessages(waState);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label={t('conversation.label', { name: chatTitle(chat, t) })}
      >
        <ConversationHeader
          chat={chat}
          directory={directory}
          onBack={onBack}
          busy={patch.isPending}
          onAssign={(id) => patch.mutate({ assignedTo: id }, { onError: toastError })}
          onToggleStatus={() =>
            patch.mutate(
              { status: chat.status === 'resolved' ? 'open' : 'resolved' },
              { onError: toastError },
            )
          }
          notesOpen={notesOpen}
          notesCount={notes?.length ?? 0}
          onToggleNotes={() => setNotesOpen((o) => !o)}
        />
        <MessageList
          items={items}
          messagesById={messagesById}
          isGroup={chat.type === 'group'}
          directory={directory}
          loading={messagesQ.isPending}
          hasOlder={!!hasNextPage}
          loadingOlder={isFetchingNextPage}
          onLoadOlder={loadOlder}
          onRetry={onRetry}
          retryingId={retryingId}
        />
        <div className="safe-bottom border-t bg-surface">
          <TypingIndicator entries={typing[jid] ?? []} meId={me?.id ?? null} />
          {(blocked || queued) && (
            <p
              className={
                blocked
                  ? 'px-3 pt-2 text-xs font-medium text-danger'
                  : 'px-3 pt-2 text-xs font-medium text-warning'
              }
              role="status"
            >
              {blocked ? t('conversation.sendingBlocked') : t('conversation.reconnecting')}
            </p>
          )}
          <div className="px-2 py-2 sm:px-3">
            <Composer
              key={jid}
              quickReplies={quickReplies.data ?? []}
              disabled={blocked}
              placeholder={
                blocked ? t('conversation.placeholderBlocked') : t('conversation.placeholder')
              }
              confirmSend={confirmSend}
              onTyping={() => emitTyping(jid)}
              onSend={(text) => sendText.mutate({ text, clientId: newClientId() })}
              onAttach={(file, caption) =>
                sendMedia.mutate({ file, caption, clientId: newClientId() })
              }
              onVoice={(note) => sendVoice.mutate({ ...note, clientId: newClientId() })}
            />
          </div>
        </div>
      </section>
      <NotesPanel
        jid={jid}
        open={notesOpen}
        notes={notes ?? []}
        loading={notesQ.isPending}
        directory={directory}
        onClose={() => setNotesOpen(false)}
      />
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && closeConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('conversation.confirmTitle', { name: confirm?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                t={t}
                i18nKey="conversation.confirmBody"
                values={{ name: confirm?.name ?? '' }}
                components={{ strong: <strong className="text-foreground" /> }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-9" onClick={() => closeConfirm(false)}>
              {t('common:actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction className="min-h-11 sm:min-h-9" onClick={() => closeConfirm(true)}>
              {t('conversation.replyAnyway')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
