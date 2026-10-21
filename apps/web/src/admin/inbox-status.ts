import type { WaState } from '@ezychat/shared';
import type { StatusTone } from '@/components/app';

/** What the inbox card says next to its status: scan the QR code, or the phone is offline. */
export type InboxNotice = 'scan' | 'offline' | 'replaced' | null;

export interface InboxCardStatus {
  tone: StatusTone;
  /** Translation key in the `admin` namespace. */
  labelKey: string;
  notice: InboxNotice;
  /** The phone must scan a QR code (or enter a pairing code) before the inbox works. */
  needsLink: boolean;
}

const STATUS: Record<WaState, InboxCardStatus> = {
  open: { tone: 'success', labelKey: 'inboxes.state.connected', notice: null, needsLink: false },
  connecting: {
    tone: 'warning',
    labelKey: 'whatsapp.state.connecting',
    notice: null,
    needsLink: false,
  },
  qr: { tone: 'warning', labelKey: 'inboxes.state.waiting_scan', notice: 'scan', needsLink: true },
  logged_out: {
    tone: 'warning',
    labelKey: 'inboxes.state.waiting_scan',
    notice: 'scan',
    needsLink: true,
  },
  disconnected: {
    tone: 'danger',
    labelKey: 'inboxes.state.phone_offline',
    notice: 'offline',
    needsLink: false,
  },
  replaced: {
    tone: 'danger',
    labelKey: 'whatsapp.state.replaced',
    notice: 'replaced',
    needsLink: false,
  },
  blocked: { tone: 'danger', labelKey: 'whatsapp.state.blocked', notice: null, needsLink: true },
};

/** WhatsApp connection state of one inbox → the status its card shows. */
export function inboxCardStatus(state: WaState): InboxCardStatus {
  // A state added on the server before the web knows it: say it as it is, in a neutral tone.
  return STATUS[state] ?? { tone: 'muted', labelKey: '', notice: null, needsLink: false };
}

/** Phone-number digits from WhatsApp (`60112233445`) → `+60112233445`; anything else as it is. */
export function formatInboxNumber(number: string | null): string | null {
  if (!number) return null;
  return /^\d+$/.test(number) ? `+${number}` : number;
}
