// Proposed (mcp-for-members), mock only: the admin switch "Members can connect AI assistants" and the access tokens of
// team members, kept in this browser (localStorage) so the admin page, the member's account page and the app
// sign-in approve page show one consistent story without any new server endpoint. `?members=0|1` in the address
// sets the switch too (used by the screenshot script). Production: setting `mcp_members`, `/api/integrations/tokens*`
// accepting a signed-in member (own tokens only), `/api/oauth/*` accepting a member while the switch is on
// (design.md -> Rules).
import { useSyncExternalStore } from 'react';

export interface MockMemberToken {
  id: number;
  /** The member's username (matches the signed-in user in the mock). */
  owner: string;
  ownerName: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  canSend: boolean;
  canMessageNewNumbers: boolean;
  /** Always true for members: they connect assistants through the app sign-in, never with a token. */
  connectedApp: boolean;
}

interface State {
  enabled: boolean;
  tokens: MockMemberToken[];
  nextId: number;
}

const KEY = 'mock.members.v2';
const DAY = 24 * 60 * 60 * 1000;
const listeners = new Set<() => void>();

function seed(): State {
  const now = Date.now();
  return {
    enabled: true,
    nextId: 9100,
    tokens: [
      {
        id: 9001,
        owner: 'daniel',
        ownerName: 'Daniel',
        name: 'Claude',
        prefix: 'ezc_pat_k4Qx',
        createdAt: now - 6 * DAY,
        lastUsedAt: now - 3 * 60 * 60 * 1000,
        expiresAt: null,
        canSend: true,
        canMessageNewNumbers: false,
        connectedApp: true,
      },
      {
        id: 9002,
        owner: 'ravi',
        ownerName: 'Ravi Kumar',
        name: 'ChatGPT',
        prefix: 'ezc_pat_Zm7B',
        createdAt: now - 2 * DAY,
        lastUsedAt: now - 26 * 60 * 1000,
        expiresAt: null,
        canSend: false,
        canMessageNewNumbers: false,
        connectedApp: true,
      },
    ],
  };
}

function read(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* storage unavailable or damaged: start from the demo seed */
  }
  return seed();
}

let state = read();

function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* keep it for this page */
  }
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') {
  const param = new URLSearchParams(window.location.search).get('members');
  if (param === '1' || param === '0') commit({ ...state, enabled: param === '1' });
}

/** The admin switch. Turning it off revokes every member's token (design.md, rule "Switch off"). */
export function setMembersEnabled(enabled: boolean): number {
  const revoked = enabled ? 0 : state.tokens.length;
  commit({ ...state, enabled, tokens: enabled ? state.tokens : [] });
  return revoked;
}

export function resetMockMembers() {
  commit(seed());
}

export function createMemberToken(
  owner: { username: string; displayName: string },
  body: {
    name: string;
    expiresInDays: number | null;
    canSend: boolean;
    canMessageNewNumbers: boolean;
  },
  options: { connectedApp?: boolean } = {},
): string {
  const id = state.nextId;
  const now = Date.now();
  const secret = `ezc_pat_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 26)}`;
  commit({
    ...state,
    nextId: id + 1,
    tokens: [
      ...state.tokens,
      {
        id,
        owner: owner.username,
        ownerName: owner.displayName,
        name: body.name,
        prefix: secret.slice(0, 12),
        createdAt: now,
        lastUsedAt: null,
        expiresAt: body.expiresInDays === null ? null : now + body.expiresInDays * DAY,
        canSend: body.canSend,
        canMessageNewNumbers: body.canSend && body.canMessageNewNumbers,
        connectedApp: options.connectedApp ?? false,
      },
    ],
  });
  return secret;
}

export function updateMemberToken(
  id: number,
  patch: Pick<MockMemberToken, 'canSend' | 'canMessageNewNumbers'>,
) {
  commit({ ...state, tokens: state.tokens.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
}

export function revokeMemberToken(id: number) {
  commit({ ...state, tokens: state.tokens.filter((x) => x.id !== id) });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useMembersEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => state.enabled);
}

export function useMemberTokens(): MockMemberToken[] {
  return useSyncExternalStore(subscribe, () => state.tokens);
}
