import { useCallback, useMemo } from 'react';
import type { Inbox } from '@ezychat/shared';
import { useInboxes } from '../api/queries';

export { useInboxStatus } from '../api/queries';

const NONE: Inbox[] = [];

/**
 * The active inboxes the signed-in user may open. The server already filters `GET /api/inboxes` by
 * access, so there is no access logic here; removed inboxes (admins only) are left out.
 */
export function useVisibleInboxes(): Inbox[] {
  const { data } = useInboxes();
  const all = data?.inboxes;
  return useMemo(() => (all ? all.filter((i) => !i.removed) : NONE), [all]);
}

/**
 * The inbox chip of a chat: the chat's inbox while the user sees two or more inboxes, otherwise
 * undefined (one inbox and Lite show no chip). Removed inboxes still name their read-only chats.
 */
export function useInboxOfChat(): (inboxId: number) => Inbox | undefined {
  const { data } = useInboxes();
  const all = data?.inboxes;
  const byId = useMemo(() => {
    const visible = (all ?? NONE).filter((i) => !i.removed);
    return visible.length > 1 ? new Map((all ?? NONE).map((i) => [i.id, i])) : null;
  }, [all]);
  return useCallback((inboxId: number) => byId?.get(inboxId), [byId]);
}
