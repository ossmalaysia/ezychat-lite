import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { CreateInboxBodyInput, Inbox, UpdateInboxBody, User } from '@ezychat/shared';
import { api } from './client';
import { qk, type WaAction } from './queries';

/**
 * Admin → Inboxes writes. Each change can move who may open which inbox, so the inbox list, the
 * members (their `inboxIds`), the team directory (assign dropdown) and the audit log all refresh.
 */
function refreshInboxData(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.inboxes }),
    qc.invalidateQueries({ queryKey: qk.users }),
    qc.invalidateQueries({ queryKey: qk.audit }),
  ]);
}

export function useCreateInbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInboxBodyInput) => api<Inbox>('/inboxes', { method: 'POST', body }),
    onSuccess: () => refreshInboxData(qc),
  });
}

export function useUpdateInbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: UpdateInboxBody }) =>
      api<Inbox>(`/inboxes/${id}`, { method: 'PATCH', body }),
    onSuccess: () => refreshInboxData(qc),
  });
}

export function useRemoveInbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<unknown>(`/inboxes/${id}`, { method: 'DELETE' }),
    // Its chats become read only; the chat list shows that.
    onSuccess: () =>
      Promise.all([refreshInboxData(qc), qc.invalidateQueries({ queryKey: qk.chatsAll })]),
  });
}

/** Log out, link again or take over the phone of one inbox. */
export function useInboxWaAction(inboxId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: WaAction) =>
      api<unknown>(`/inboxes/${inboxId}/wa/${action}`, { method: 'POST' }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.inboxes }),
        // Inbox 1 is also `/wa/status` (the WhatsApp page and the inbox banner read it).
        qc.invalidateQueries({ queryKey: qk.wa }),
      ]),
  });
}

/** Link one inbox by phone number: the 8-character code to enter in WhatsApp → Linked devices. */
export function useInboxPairingCode(inboxId: number) {
  return useMutation({
    mutationFn: (phone: string) =>
      api<{ code: string }>(`/inboxes/${inboxId}/wa/pairing-code`, {
        method: 'POST',
        body: { phone },
      }),
  });
}

/** Members → Inbox access: the inboxes one agent may open. */
export function useSetUserInboxes(userId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inboxIds: number[]) =>
      api<User>(`/users/${userId}/inboxes`, { method: 'PUT', body: { inboxIds } }),
    onSuccess: () => refreshInboxData(qc),
  });
}
