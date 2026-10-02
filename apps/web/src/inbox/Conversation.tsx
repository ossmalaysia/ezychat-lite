import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  useWaStatus,
  type MessagesData,
} from '../api/queries';
import { useRealtime } from '../api/socket';
import { Banner, Button, Modal, Spinner } from '../components/ui';
import { Composer } from './Composer';
import { ConversationHeader } from './ConversationHeader';
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

/** Chats where the user already agreed to reply despite another assignee (this session). */
const confirmedChats = new Set<string>();

export function Conversation({ jid, directory, onBack }: ConversationProps) {
  const qc = useQueryClient();
  const chatQ = useChat(jid);
  const messagesQ = useMessages(jid);
  const notesQ = useNotes(jid);
  const quickReplies = useQuickReplies();
  const wa = useWaStatus();
  const sendText = useSendText(jid);
  const sendMedia = useSendMedia(jid);
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

  const messages = useMemo(() => flattenMessages(messagesQ.data as MessagesData | undefined), [messagesQ.data]);
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
      if (document.visibilityState === 'visible' && (qc.getQueryData<{ chat: { unreadCount: number } }>(qk.chat(jid))?.chat.unreadCount ?? 0) > 0)
        doMarkRead();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [qc, jid, doMarkRead]);

  const confirmSend = useCallback((): Promise<boolean> | boolean => {
    if (!chat || chat.assignedTo == null || chat.assignedTo === me?.id) return true;
    if (confirmedChats.has(jid)) return true;
    const name = directory.nameOf(chat.assignedTo) ?? 'someone else';
    return new Promise<boolean>((resolve) => setConfirm({ name, resolve }));
  }, [chat, me?.id, jid, directory]);

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
        if (e instanceof ApiError && e.status === 404 && m.id.startsWith('local-') && m.type === 'text' && m.body) {
          qc.setQueryData<MessagesData>(qk.messages(jid), (old) =>
            old
              ? { ...old, pages: old.pages.map((p) => ({ ...p, messages: p.messages.filter((x) => x.id !== m.id) })) }
              : old,
          );
          sendText.mutate({ text: m.body, quotedId: m.quotedId ?? undefined, clientId: newClientId() });
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
      <div className="flex flex-1 items-center justify-center text-emerald-600">
        <Spinner className="size-6" label="Loading chat" />
      </div>
    );
  }

  if (chatQ.isError || !chat) {
    const notFound = chatQ.error instanceof ApiError && chatQ.error.status === 404;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
        <p>{notFound ? 'This chat doesn’t exist.' : 'Couldn’t load this chat.'}</p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onBack}>
            Back to chats
          </Button>
          {!notFound && (
            <Button size="sm" onClick={() => void chatQ.refetch()}>
              Try again
            </Button>
          )}
        </div>
      </div>
    );
  }

  const waState = wa.data?.state;
  const blocked = waSendingBlocked(waState);
  const queued = waQueuesMessages(waState);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={`Conversation with ${chat.name}`}>
        <ConversationHeader
          chat={chat}
          directory={directory}
          onBack={onBack}
          busy={patch.isPending}
          onAssign={(id) => patch.mutate({ assignedTo: id })}
          onToggleStatus={() =>
            patch.mutate({ status: chat.status === 'resolved' ? 'open' : 'resolved' })
          }
          notesOpen={notesOpen}
          notesCount={notes?.length ?? 0}
          onToggleNotes={() => setNotesOpen((o) => !o)}
        />
        {patch.isError && (
          <div className="px-3 pt-2">
            <Banner tone="error">
              {patch.error instanceof Error ? patch.error.message : 'Update failed'}
            </Banner>
          </div>
        )}
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
        <div className="safe-bottom border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <TypingIndicator entries={typing[jid] ?? []} meId={me?.id ?? null} />
          {(blocked || queued) && (
            <p
              className={
                blocked
                  ? 'px-3 pt-2 text-xs font-medium text-red-700 dark:text-red-400'
                  : 'px-3 pt-2 text-xs font-medium text-amber-700 dark:text-amber-400'
              }
              role="status"
            >
              {blocked
                ? 'Sending is unavailable until WhatsApp is linked again.'
                : 'WhatsApp is reconnecting — messages will send when reconnected.'}
            </p>
          )}
          <div className="px-2 py-2 sm:px-3">
            <Composer
              key={jid}
              quickReplies={quickReplies.data ?? []}
              disabled={blocked}
              placeholder={blocked ? 'WhatsApp is not connected' : 'Type a message — “/” for quick replies'}
              confirmSend={confirmSend}
              onTyping={() => emitTyping(jid)}
              onSend={(text) => sendText.mutate({ text, clientId: newClientId() })}
              onAttach={(file, caption) =>
                sendMedia.mutate({ file, caption, clientId: newClientId() })
              }
            />
          </div>
        </div>
      </section>
      {notesOpen && (
        <NotesPanel
          jid={jid}
          notes={notes ?? []}
          loading={notesQ.isPending}
          directory={directory}
          onClose={() => setNotesOpen(false)}
        />
      )}
      <Modal
        open={!!confirm}
        onClose={() => closeConfirm(false)}
        title={`Assigned to ${confirm?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => closeConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => closeConfirm(true)}>Reply anyway</Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          This chat is assigned to <strong>{confirm?.name}</strong> — reply anyway? You won’t be
          asked again for this chat during this session.
        </p>
      </Modal>
    </div>
  );
}
