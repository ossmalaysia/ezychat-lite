import { api, ApiError } from '@/api/client';

/** Mock-only state of the Ask Ezy stand-in (the dashed box in the panel). */
export type MockAskEzyMode = 'normal' | 'slow' | 'error' | 'timeout' | 'expired' | 'no_connection';

export interface AskTest {
  question: string;
  before: string;
  after: string;
}

/** One piece of an answer the panel draws. Ezy never sends HTML: it fills one of these blocks. */
export type AskBlock =
  | {
      type: 'stats';
      items: Array<{
        label: string;
        value: string;
        note?: string;
        change?: string;
        good?: boolean;
      }>;
    }
  | { type: 'bars'; title: string; finding?: string; rows: Array<{ label: string; count: number }> }
  | { type: 'heatmap'; title: string; finding?: string; hours: number[][] }
  | {
      type: 'chats';
      title: string;
      chats: Array<{
        jid: string;
        name: string;
        preview: string;
        wait: string;
        assignee: string | null;
      }>;
    }
  | {
      type: 'customer';
      jid: string;
      name: string;
      /** Facts the tools return (first message, message count, tags, assignee): never invented numbers. */
      facts: string[];
      points: string[];
      open: string[];
      next: string;
    }
  | {
      type: 'change';
      id: string;
      agent: string;
      title: string;
      /** Where the text goes ("Business context", "AI agent setup"). */
      target: string;
      /** What the change does ("Adds 1 line"). */
      summary: string;
      before: string;
      after: string;
      reason: string;
      test?: AskTest;
      status: 'proposed' | 'applied' | 'discarded';
      version?: number;
    }
  | ({ type: 'test' } & AskTest);

export interface AskAnswer {
  text: string;
  blocks: AskBlock[];
  /** What Ezy read, as nouns with counts ("inbox statistics (7 days)"). */
  steps: string[];
  followUps: string[];
}

export interface MockState {
  mode: MockAskEzyMode;
  applyConflict: boolean;
  connected: boolean;
}

/**
 * Asks one question. `onStep` receives each tool step as Ezy works; resolves with the answer, or throws an
 * ApiError (`ai_not_connected`, `ai_unavailable`, `ai_timeout`, `ai_expired`) or an AbortError.
 */
export async function askEzy(
  question: string,
  chatJid: string | null,
  onStep: (label: string) => void,
  signal: AbortSignal,
): Promise<AskAnswer> {
  const res = await fetch('/api/mock/ask-ezy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify({ question, chatJid }),
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'ai_unavailable',
      body?.error?.message ?? 'Failed',
    );
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as
        | { type: 'step'; label: string }
        | { type: 'answer'; answer: AskAnswer }
        | { type: 'error'; code: string };
      if (event.type === 'step') onStep(event.label);
      else if (event.type === 'answer') return event.answer;
      else throw new ApiError(503, event.code, event.code);
    }
  }
  throw new ApiError(503, 'ai_unavailable', 'The answer stopped early');
}

export const changeAction = (id: string, action: 'apply' | 'discard' | 'undo') =>
  api<{ status: 'proposed' | 'applied' | 'discarded'; version?: number }>(
    `/mock/ask-ezy/changes/${id}/${action}`,
    { method: 'POST', body: {} },
  );

export const getMockState = () => api<MockState>('/mock/ask-ezy/state');
export const setMockState = (body: Partial<Pick<MockState, 'mode' | 'applyConflict'>>) =>
  api<MockState>('/mock/ask-ezy/state', { method: 'PUT', body });
