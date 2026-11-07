// Proposed (forward-message): forward one message to up to 5 existing chats or groups. The app sends
// `POST /api/messages/:id/forward` and reads `Message.forwarded` from the server; the mock asks its own
// routes (`forward.ts` in the mock folder) and keeps the "Forwarded" marks there.
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export type ForwardScenario = 'normal' | 'offline';

export interface ForwardState {
  scenario: ForwardScenario;
  /** message id → forwarding score (1 = "Forwarded", ≥ manyTimesScore = "Forwarded many times"). */
  forwarded: Record<string, number>;
  /** Messages WhatsApp Safety rated High: their files are locked and never forwarded. */
  safetyLocked: string[];
  limits: { maxChats: number; manyTimesScore: number; perMinute: number };
}

export const forwardKey = ['mock', 'forward'] as const;

export function useForwardState() {
  return useQuery({
    queryKey: forwardKey,
    queryFn: () => api<ForwardState>('/mock/forward'),
    refetchInterval: 4_000,
  });
}

/** The message's forwarded mark as WhatsApp shows it, or null. */
export function forwardedMark(
  state: ForwardState | undefined,
  messageId: string,
): 'once' | 'many' | null {
  const score = state?.forwarded[messageId];
  if (!score) return null;
  return score >= (state?.limits.manyTimesScore ?? 5) ? 'many' : 'once';
}
