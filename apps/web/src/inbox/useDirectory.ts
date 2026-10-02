import { useMemo } from 'react';
import type { User } from '@wa-team-inbox/shared';
import { useUserDirectory, useUsers, type DirectoryUser } from '../api/queries';
import { useAuth } from '../auth/AuthProvider';

export interface Directory {
  me: User | null;
  isAdmin: boolean;
  byId: Map<number, DirectoryUser>;
  /** Users that can be picked as assignee (active only). */
  assignable: DirectoryUser[];
  /** Display name for a user id ("You" for the current user when `youLabel`). */
  nameOf(id: number | null | undefined, opts?: { youLabel?: boolean }): string | null;
}

/** Pure builder (exported for tests). */
export function buildDirectory(
  me: User | null,
  isAdmin: boolean,
  list: readonly DirectoryUser[] | undefined,
): Directory {
  const byId = new Map<number, DirectoryUser>();
  for (const u of list ?? []) byId.set(u.id, u);
  if (me) byId.set(me.id, me);
  const assignable = [...byId.values()]
    .filter((u) => !u.disabled)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return {
    me,
    isAdmin,
    byId,
    assignable,
    nameOf(id, opts) {
      if (id == null) return null;
      if (opts?.youLabel && me && id === me.id) return 'You';
      return byId.get(id)?.displayName ?? `Agent #${id}`;
    },
  };
}

/**
 * Team member lookup for the inbox. Admins use the full `GET /api/users`; every other role
 * uses the public `GET /api/users/directory` ({id, displayName, role, disabled}). Ids that are
 * still unknown render as "Agent #<id>".
 */
export function useDirectory(): Directory {
  const { user: me, isAdmin } = useAuth();
  const users = useUsers({ enabled: isAdmin });
  const directory = useUserDirectory({ enabled: !isAdmin && me != null });
  const list: readonly DirectoryUser[] | undefined = isAdmin ? users.data : directory.data;

  return useMemo(() => buildDirectory(me, isAdmin, list), [list, me, isAdmin]);
}
