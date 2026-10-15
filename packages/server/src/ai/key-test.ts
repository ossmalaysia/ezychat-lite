import type { AiKeyTestResponse } from '@ezychat/shared';
import type { Logger } from 'pino';

/** Lists models with the key: the cheapest call that proves the key works (no tokens used). */
export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
export const AI_KEY_TEST_TIMEOUT_MS = 8_000;

/** Checks an OpenAI API key; never stores or logs it. */
export type AiKeyTester = (apiKey: string) => Promise<AiKeyTestResponse>;

declare module '../context.js' {
  interface Services {
    /** Tests replace this to avoid calling OpenAI. */
    aiKeyTest?: AiKeyTester;
  }
}

export function createAiKeyTester(opts: {
  log: Logger;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): AiKeyTester {
  const log = opts.log.child({ mod: 'ai' });
  const fetchImpl = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = opts.timeoutMs ?? AI_KEY_TEST_TIMEOUT_MS;
  return async (apiKey) => {
    const started = Date.now();
    let result: AiKeyTestResponse;
    let status: number | null = null;
    try {
      const response = await fetchImpl(OPENAI_MODELS_URL, {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      // The body is not needed; release the connection.
      await response.body?.cancel().catch(() => undefined);
      if (response.ok) result = { ok: true, error: null };
      else if (status === 401) result = { ok: false, error: 'invalid_key' };
      // A restricted key without the Models permission, or a blocked region: the key itself is real.
      else if (status === 403) result = { ok: false, error: 'forbidden' };
      else if (status === 429) result = { ok: false, error: 'rate_limited' };
      else result = { ok: false, error: 'unreachable' };
    } catch {
      // Network failure or timeout; the error itself is not logged (it never needs the key).
      result = { ok: false, error: 'unreachable' };
    }
    log.info(
      {
        event: 'ai_key_test',
        ok: result.ok,
        error: result.error,
        status,
        ms: Date.now() - started,
      },
      'OpenAI API key tested',
    );
    return result;
  };
}
