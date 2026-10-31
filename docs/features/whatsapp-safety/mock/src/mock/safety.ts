import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

/**
 * Proposed (whatsapp-safety), mock only: what the stand-in routes `/api/mock/safety*` serve
 * (../../safety.ts). Production: `GET /api/safety` (admins), the flags inside each Message, and
 * `POST /api/safety/items/:id/<action>`.
 */
export type SafetyLevel = 'none' | 'warning' | 'high';
export type SafetyStatus = 'open' | 'safe' | 'reported' | 'blocked' | 'cleared';
export type SafetyRule =
  | 'exeInZip'
  | 'executable'
  | 'doubleExtension'
  | 'scamNumber'
  | 'cantInspect'
  | 'macroFile'
  | 'passwordInMessage'
  | 'openOnComputer'
  | 'lookalikeLink'
  | 'financeUrgency'
  | 'firstFile';
export type SafetyScenario =
  'zipLure' | 'hackedCustomer' | 'phishingLink' | 'macroDoc' | 'lockedArchive' | 'falseAlarm';

export interface SafetyAi {
  level: SafetyLevel;
  category: 'malware_lure' | 'phishing' | 'impersonation' | 'payment_fraud' | 'none';
  reason: SafetyScenario;
}

export interface SafetyItem {
  id: string;
  messageId: string;
  chatJid: string;
  phone: string;
  senderName: string;
  scenario: SafetyScenario;
  at: number;
  text: string;
  file: { name: string; inside: string[] } | null;
  ruleCodes: SafetyRule[];
  ruleScore: number;
  ruleLevel: SafetyLevel;
  critical: boolean;
  ai: SafetyAi | null;
  level: SafetyLevel;
  status: SafetyStatus;
  existingCustomer: boolean;
  quarantined: boolean;
  released: boolean;
  deleted: { by: string; at: number } | null;
  autoBlocked: boolean;
  downloads: Array<{ name: string; at: number }>;
  history: Array<{ action: string; by: string; at: number }>;
  scam: boolean;
  blocked: boolean;
}

export interface SafetySettings {
  enabled: boolean;
  ai: boolean;
  autoBlock: boolean;
  deleteAfterDays: 7 | 30 | 90;
}

export interface SafetyState {
  settings: SafetySettings;
  items: SafetyItem[];
  blocked: Array<{
    chatJid: string;
    phone: string;
    name: string;
    by: string;
    at: number;
    auto: boolean;
  }>;
  scenarios: SafetyScenario[];
}

export interface MessageFlag {
  id: string;
  level: SafetyLevel;
  ruleCodes: SafetyRule[];
  ai: SafetyAi | null;
  locked: boolean;
  deleted: { by: string; at: number } | null;
  status: SafetyStatus;
}

export interface SafetyFlags {
  enabled: boolean;
  messages: Record<string, MessageFlag>;
  chats: Record<
    string,
    {
      itemId: string;
      scam: boolean;
      blocked: { by: string; at: number; auto: boolean } | null;
      maybeHacked: boolean;
    }
  >;
}

const FLAGS = ['mock-safety-flags'];
const STATE = ['mock-safety'];

/** Flags for the chat screen (every signed-in user). Polled: the mock has no safety socket event. */
export function useSafetyFlags() {
  return useQuery({
    queryKey: FLAGS,
    queryFn: () => api<SafetyFlags>('/mock/safety/flags'),
    refetchInterval: 2000,
  });
}

export function useSafety(enabled = true) {
  return useQuery({
    queryKey: STATE,
    queryFn: () => api<SafetyState>('/mock/safety'),
    refetchInterval: 2000,
    enabled,
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return (state?: SafetyState) => {
    if (state) qc.setQueryData(STATE, state);
    void qc.invalidateQueries({ queryKey: FLAGS });
    void qc.invalidateQueries({ queryKey: STATE });
  };
}

export function useSafetySettings() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Partial<SafetySettings>) =>
      api<SafetyState>('/mock/safety/settings', { method: 'PUT', body }),
    onSuccess: refresh,
  });
}

export type SafetyAction = 'safe' | 'release' | 'delete' | 'report' | 'block' | 'unblock';

export function useSafetyAction() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string;
      action: SafetyAction;
      body?: Record<string, unknown>;
    }) =>
      api<SafetyState>(`/mock/safety/items/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        body: body ?? {},
      }),
    onSuccess: refresh,
  });
}

/** Records the download (who and when); refused for an agent while the file is locked. */
export function useSafetyDownload() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: true }>(`/mock/safety/download/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: {},
      }),
    onSettled: () => refresh(),
  });
}

export function useSimulate() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (scenario: SafetyScenario) =>
      api<{ item: SafetyItem | null; state: SafetyState }>('/mock/safety/simulate', {
        method: 'POST',
        body: { scenario },
      }),
    onSuccess: (result) => refresh(result.state),
  });
}
