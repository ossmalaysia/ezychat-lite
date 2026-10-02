import { useMemo } from 'react';
import type { User } from '@wa-team-inbox/shared';
import { useUsers } from '../api/queries';
import { useAuth } from '../auth/AuthProvider';

export interface Directory {
  me: User | null;
  isAdmin: boolean;
  byId: Map<number, User>;
  /** Users that can be picked as assignee (active only). */
  assignable: User[];
  /** Display name for a user id ("You" for the current user when `youLabel`). */
  nameOf(id: number | null | undefined, opts?: { youLabel?: boolean }): string | null;
}

/**
 * Team member lookup for the inbox. `GET /api/users` is admin-only, so agents only know
 * themselves; unknown ids render as "Agent #<id>".
 */
export function useDirectory(): Directory {
  const { user: me, isAdmin } = useAuth();
  const users = useUsers({ enabled: isAdmin });
  const list = users.data;

  return useMemo(() => {
    const byId = new Map<number, User>();
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
  }, [list, me, isAdmin]);
}
