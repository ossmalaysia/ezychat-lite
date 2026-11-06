import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';

/**
 * Proposed (partner-role), mock only: partners and the chats shared with them, as the stand-in routes
 * `/api/mock/partner-role*` serve them (../../partner-role.ts). Production: `User.role === 'partner'`
 * and `GET/POST/DELETE /api/users/:id/shares`, `GET/POST /api/chats/:jid/shares` (design.md → API).
 */
export interface PartnerShare {
  id: string;
  userId: number;
  chatJid: string;
  chatName: string;
  chatType: 'dm' | 'group';
  grantedBy: number;
  grantedAt: number;
  expiresAt: number | null;
  historyFrom: number | null;
}

export interface PartnerRow {
  userId: number;
  displayName: string;
  company: string;
  invitedAt: number;
  shares: PartnerShare[];
}

export interface PartnerLogRow {
  at: number;
  by: string;
  action:
    | 'partner.invited'
    | 'chat_share.added'
    | 'chat_share.changed'
    | 'chat_share.removed'
    | 'chat_share.expired'
    | 'partner_notes.changed';
  partner: string;
  chat: string | null;
}

export interface PartnerState {
  me: { partner: false } | { partner: true; company: string; shares: PartnerShare[] };
  notesForPartners: boolean;
  longList?: boolean;
  partners?: PartnerRow[];
  log?: PartnerLogRow[];
}

const KEY = ['mock-partner-role'] as const;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function usePartnerState() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...KEY, user?.id ?? 0],
    queryFn: () => api<PartnerState>('/mock/partner-role'),
    enabled: !!user,
    // Removal and expiry take effect live (production: socket rooms rebuilt + `chat:unshared`).
    refetchInterval: 4000,
  });
}

/** The signed-in partner's view; `isPartner` false for admins and agents. */
export function usePartnerMe(): {
  isPartner: boolean;
  company: string;
  shares: PartnerShare[];
  /** Internal notes visible in shared chats (always true for the team). */
  notes: boolean;
  loaded: boolean;
} {
  const q = usePartnerState();
  const me = q.data?.me;
  return me?.partner
    ? {
        isPartner: true,
        company: me.company,
        shares: me.shares,
        notes: q.data!.notesForPartners,
        loaded: true,
      }
    : { isPartner: false, company: '', shares: [], notes: true, loaded: !!q.data };
}

export function useIsPartner(): boolean {
  return usePartnerMe().isPartner;
}

/** The partner's share of one chat (undefined = not shared, or not a partner). */
export function useShareOf(jid: string): PartnerShare | undefined {
  return usePartnerMe().shares.find((s) => s.chatJid === jid);
}

export function usePartnerRows(): PartnerRow[] {
  return usePartnerState().data?.partners ?? [];
}

function useChange<V>(run: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export const useMarkPartner = () =>
  useChange((v: { userId: number; company: string }) =>
    api('/mock/partner-role/partners', { method: 'POST', body: v }),
  );

export const useSaveShare = () =>
  useChange(
    (v: {
      userId: number;
      chatJid: string;
      expiresAt: number | null;
      historyFrom: number | null;
    }) => api('/mock/partner-role/shares', { method: 'POST', body: v }),
  );

export const useRemoveShare = () =>
  useChange((id: string) => api(`/mock/partner-role/shares/${id}`, { method: 'DELETE' }));

export const useExpireShare = () =>
  useChange((id: string) => api(`/mock/partner-role/shares/${id}/expire`, { method: 'POST' }));

export const usePartnerSettings = () =>
  useChange((v: { notesForPartners?: boolean; longList?: boolean }) =>
    api('/mock/partner-role/settings', { method: 'PUT', body: v }),
  );

export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A share ending within 7 days shows "Ends in N days" in the warning tone. */
export function endsSoon(share: Pick<PartnerShare, 'expiresAt'>, now = Date.now()): boolean {
  return share.expiresAt !== null && share.expiresAt - now < 7 * DAY_MS;
}

/** Mock only: 40 fictional shares for the long-list state of the partner page. */
export function longListShares(userId: number): PartnerShare[] {
  const names = [
    'Ahmad Faizal',
    'Chong Wei Ming',
    'Deepa Krishnan',
    'Edwin Lau',
    'Fatimah Zahra',
    'Goh Siew Lan',
    'Hariz Iskandar',
    'Ivy Tan Hui Min',
    'Jayakumar Ramasamy',
    'Kelvin Ng',
    'Lee Ai Ling',
    'Mohd Shafiq bin Abdullah (Bayan Lepas branch, wholesale orders)',
    'Nadia Omar',
    'Ong Boon Keat',
    'Pavithra Devi',
    'Quek Jia Hui',
    'Rizal Hamzah',
    'Suresh Menon',
    'Teoh Kar Wai',
    'Umairah Yusof',
  ];
  const now = Date.now();
  return Array.from({ length: 40 }, (_, i) => ({
    id: `long-${i}`,
    userId,
    chatJid: `6019${String(1000000 + i)}@s.whatsapp.net`,
    chatName:
      i % 9 === 4 ? `Reseller group ${i}` : `${names[i % names.length]}${i >= 20 ? ' (2)' : ''}`,
    chatType: i % 9 === 4 ? 'group' : 'dm',
    grantedBy: 1,
    grantedAt: now - (i + 1) * DAY_MS,
    expiresAt: i % 5 === 0 ? now + ((i % 3) + 1) * DAY_MS : null,
    historyFrom: i % 4 === 0 ? now - i * DAY_MS : null,
  }));
}
