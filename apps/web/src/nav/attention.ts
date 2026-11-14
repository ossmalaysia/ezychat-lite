import type { WaStatus } from '@ezychat/shared';
import { useInboxes } from '../api/queries';
import { useAuth } from '../auth/AuthProvider';

/** WhatsApp states an admin must act on (the ones WaBanner shows as a warning or danger). */
const ATTENTION_STATES = new Set<WaStatus['state']>([
  'disconnected',
  'qr',
  'logged_out',
  'replaced',
  'blocked',
]);

/** True when a WhatsApp number of a current (not removed) inbox needs an admin; always false for others. */
export function useNumberAttention(): boolean {
  const { isAdmin } = useAuth();
  const inboxes = useInboxes();
  if (!isAdmin) return false;
  return (inboxes.data?.inboxes ?? []).some(
    (i) => !i.removed && ATTENTION_STATES.has(i.status.state),
  );
}

/** The page of the numbers: WhatsApp in Lite (one number), Inboxes in an edition with several. */
export function useNumbersPath(): string {
  return (useInboxes().data?.maxInboxes ?? 1) > 1 ? '/admin/inboxes' : '/admin/whatsapp';
}
