// Proposed (multi-inbox): mock-only store for inboxes, the inbox of each chat and each member's inbox
// access. Kept in this browser (localStorage) so the walkthrough survives a reload; the production
// feature keeps all of this on the server and filters chats there (an agent never receives a chat of an
// inbox they cannot open).
import { useSyncExternalStore } from 'react';

export type InboxStatus = 'connected' | 'waiting_scan' | 'phone_offline';

export interface MockInbox {
  id: string;
  name: string;
  /** Display number, e.g. +60 12-345 6789 (known after the QR scan). */
  number: string;
  /**
   * Every inbox is a WhatsApp app on a phone (QR scan, as the app works today). The WhatsApp Business API
   * comes later as a second type (design.md, "Later").
   */
  type: 'linked_phone';
  status: InboxStatus;
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
  /** The chat list's inbox filter: 'all' or one inbox id (kept per browser, like the other filters). */
  inboxFilter: string;
}

// Bump the key whenever the seed changes, so open browsers load the new demo data.
const KEY = 'mock.multiInbox.v3';

const SEED: State = {
  inboxes: [
    {
      id: 'main',
      name: 'Kopi Apong',
      number: '+60 12-345 6789',
      // The number the app links today keeps working as the first inbox.
      type: 'linked_phone',
      status: 'connected',
      tone: 'primary',
    },
    {
      id: 'catering',
      name: 'Catering',
      number: '+60 13-777 0000',
      type: 'linked_phone',
      status: 'connected',
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

/** A new inbox waits for its QR scan; WhatsApp tells the number after the scan. */
export function addInbox(name: string): MockInbox {
  const tones: MockInbox['tone'][] = ['primary', 'warning', 'info', 'success'];
  const created: MockInbox = {
    id: `inbox-${Date.now().toString(36)}`,
    name,
    number: '',
    type: 'linked_phone',
    tone: tones[state.inboxes.length % tones.length]!,
    status: 'waiting_scan',
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

/** From the inbox side: exactly these agents may open the inbox (others among `agentIds` lose it). */
export function setInboxMembers(inboxId: string, agentIds: number[], allowed: number[]) {
  const access = { ...state.access };
  for (const id of agentIds) {
    const current = access[id];
    const list = Array.isArray(current) ? current.filter((x) => x !== inboxId) : [];
    access[id] = allowed.includes(id) ? [...list, inboxId] : list;
  }
  save({ ...state, access });
}

/** Back to the seeded demo (walkthrough reset). */
export function resetMockInboxes() {
  save(structuredClone(SEED));
}

export function setInboxFilter(inboxFilter: string) {
  save({ ...state, inboxFilter });
}
