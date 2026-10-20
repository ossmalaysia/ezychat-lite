// Proposed (multi-inbox): mock-only store for inboxes, the inbox of each chat and each member's inbox
// access. Kept in this browser (localStorage) so the walkthrough survives a reload; the production
// feature keeps all of this on the server and filters chats there (an agent never receives a chat of an
// inbox they cannot open).
import { useSyncExternalStore } from 'react';

export type InboxStatus = 'connected' | 'webhook_waiting' | 'token_invalid';

export interface MockInbox {
  id: string;
  name: string;
  /** Display number, e.g. +60 12-345 6789. */
  number: string;
  /** Only the WhatsApp Business API in this proposal; the linked phone comes later. */
  type: 'business_api';
  status: InboxStatus;
  /** Meta ids the admin pasted (shown, never secret). */
  phoneNumberId: string;
  businessAccountId: string;
  /** Short colour token for the inbox chip (design-system tone, never a hex value). */
  tone: 'primary' | 'info' | 'warning' | 'success';
}

/** 'all' = every inbox (admins always); otherwise the ids an agent may open. */
export type InboxAccess = 'all' | string[];

interface State {
  inboxes: MockInbox[];
  /** chat JID → inbox id. */
  chatInbox: Record<string, string>;
  /** user id → access. Admins are not listed: they always see all inboxes. */
  access: Record<number, InboxAccess>;
  /** Chats whose 24-hour customer-service window is closed (Business API rule). */
  windowClosed: string[];
  /** The chat list's inbox filter: 'all' or one inbox id (kept per browser, like the other filters). */
  inboxFilter: string;
}

const KEY = 'mock.multiInbox.v1';

const SEED: State = {
  inboxes: [
    {
      id: 'main',
      name: 'Kopi Apong',
      number: '+60 12-345 6789',
      type: 'business_api',
      status: 'connected',
      phoneNumberId: '109876543210001',
      businessAccountId: '201234567890123',
      tone: 'primary',
    },
    {
      id: 'catering',
      name: 'Catering',
      number: '+60 13-777 0000',
      type: 'business_api',
      status: 'connected',
      phoneNumberId: '109876543210002',
      businessAccountId: '201234567890123',
      tone: 'warning',
    },
  ],
  chatInbox: {
    '60123110021@s.whatsapp.net': 'catering',
    '60126677889@s.whatsapp.net': 'catering',
    '60125550142@s.whatsapp.net': 'main',
    '60127020388@s.whatsapp.net': 'main',
    '60128814455@s.whatsapp.net': 'main',
    '60129001234@s.whatsapp.net': 'main',
  },
  // Seeded users: 1 Aisyah (admin), 2 Daniel, 3 Mei Ling.
  access: { 2: ['main'], 3: ['catering'] },
  windowClosed: ['60125550142@s.whatsapp.net'],
  inboxFilter: 'all',
};

let state: State = load();
const listeners = new Set<() => void>();

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    // Private window or blocked storage: start from the seed.
  }
  return structuredClone(SEED);
}

function save(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: keep the change for this page only.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMockInboxes(): State {
  return useSyncExternalStore(subscribe, () => state);
}

/** The inbox of a chat; chats the seed does not know (new ones) belong to the first inbox. */
export function inboxOfChat(s: State, jid: string): MockInbox | undefined {
  const id = s.chatInbox[jid] ?? s.inboxes[0]?.id;
  return s.inboxes.find((i) => i.id === id);
}

export function accessOf(
  s: State,
  user: { id: number; role: string } | null | undefined,
): InboxAccess {
  if (!user) return [];
  if (user.role === 'admin') return 'all';
  return s.access[user.id] ?? [];
}

export function canOpen(access: InboxAccess, inboxId: string | undefined): boolean {
  return access === 'all' || (!!inboxId && access.includes(inboxId));
}

export function addInbox(inbox: Omit<MockInbox, 'id' | 'tone' | 'status'>): MockInbox {
  const tones: MockInbox['tone'][] = ['primary', 'warning', 'info', 'success'];
  const created: MockInbox = {
    ...inbox,
    id: `inbox-${Date.now().toString(36)}`,
    tone: tones[state.inboxes.length % tones.length]!,
    // Meta has not called the webhook yet: the admin still has to paste the callback URL.
    status: 'webhook_waiting',
  };
  save({ ...state, inboxes: [...state.inboxes, created] });
  return created;
}

export function updateInbox(id: string, patch: Partial<MockInbox>) {
  save({ ...state, inboxes: state.inboxes.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
}

export function removeInbox(id: string) {
  save({ ...state, inboxes: state.inboxes.filter((i) => i.id !== id) });
}

export function setAccess(userId: number, access: string[]) {
  save({ ...state, access: { ...state.access, [userId]: access } });
}

/** Back to the seeded demo (walkthrough reset). */
export function resetMockInboxes() {
  save(structuredClone(SEED));
}

export function setInboxFilter(inboxFilter: string) {
  save({ ...state, inboxFilter });
}

export function isWindowClosed(s: State, jid: string): boolean {
  return s.windowClosed.includes(jid);
}

/** A template message opens the 24-hour window again only once the customer replies; the mock
 * simulates the reply so the rest of the flow can be tried. */
export function reopenWindow(jid: string) {
  save({ ...state, windowClosed: state.windowClosed.filter((j) => j !== jid) });
}

/** Approved templates the mock offers (production reads them from Meta). */
export const MOCK_TEMPLATES = [
  {
    name: 'order_follow_up',
    language: 'en',
    body: 'Hi {{1}}, thank you for your order at {{2}}. Reply to this message if you need anything else.',
    params: ['Customer name', 'Shop name'],
  },
  {
    name: 'catering_quote',
    language: 'en',
    body: 'Hi {{1}}, here is your catering quote: {{2}}. Reply YES to confirm.',
    params: ['Customer name', 'Quote link'],
  },
] as const;
