import {
  AskEzyChangeResult,
  AskEzyEvent,
  AskEzyStatus,
  type AskEzyAnswer,
  type AskEzyStep,
  type AskEzyTurn,
} from '@ezychat/shared';
import { api, ApiError } from '@/api/client';

export const getAskEzyStatus = () => api('/ask-ezy/status', { schema: AskEzyStatus });

export type AskEzyChangeAction = 'apply' | 'discard' | 'undo';
export const askEzyChange = (id: string, action: AskEzyChangeAction) =>
  api(`/ask-ezy/changes/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: {},
    schema: AskEzyChangeResult,
  });

/**
 * Asks one question. The answer streams as NDJSON: `onStep` gets each tool Ezy used while it works; resolves
 * with the answer, or throws an ApiError (`ai_not_connected`, `ai_unavailable`, `ai_timeout`, `ai_expired`,
 * `rate_limited`, …) or an AbortError.
 */
export async function askEzy(
  input: { question: string; history: AskEzyTurn[]; chatJid: string | null },
  onStep: (step: AskEzyStep) => void,
  signal: AbortSignal,
): Promise<AskEzyAnswer> {
  const res = await fetch('/api/ask-ezy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify(input),
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    if (res.status === 401) window.dispatchEvent(new Event('wati:unauthorized'));
    throw new ApiError(
      res.status,
      body?.error?.code ?? (res.status === 429 ? 'rate_limited' : 'ai_unavailable'),
      body?.error?.message ?? res.statusText,
    );
  }
  if (!res.body) throw new ApiError(503, 'ai_unavailable', 'No answer');
  const reader = res.body.getReader();
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
      const parsed = AskEzyEvent.safeParse(JSON.parse(line));
      if (!parsed.success) continue;
      const event = parsed.data;
      if (event.type === 'step') onStep({ key: event.key, count: event.count });
      else if (event.type === 'answer') return event.answer;
      else throw new ApiError(503, event.code, event.code);
    }
  }
  throw new ApiError(503, 'ai_unavailable', 'The answer stopped early');
}
