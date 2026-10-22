import type { AiKeyTestResponse } from '@ezychat/shared';
import type { Logger } from 'pino';

/** Lists models with the key: the cheapest call that proves the key works (no tokens used). */
export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
/** The same check for an Anthropic Claude key. */
export const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
export const ANTHROPIC_VERSION = '2023-06-01';
export const AI_KEY_TEST_TIMEOUT_MS = 8_000;

/** Which service a key belongs to: `api` = OpenAI (the default), `claude` = Anthropic. */
export type AiKeyMode = 'api' | 'claude';
/** Checks an API key; never stores or logs it. */
export type AiKeyTester = (apiKey: string, mode?: AiKeyMode) => Promise<AiKeyTestResponse>;

declare module '../context.js' {
  interface Services {
    /** Tests replace this to avoid calling OpenAI or Anthropic. */
    aiKeyTest?: AiKeyTester;
  }
}

interface KeyTestOptions {
  log: Logger;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const PROVIDERS = {
  api: {
    url: OPENAI_MODELS_URL,
    headers: (apiKey: string): Record<string, string> => ({ authorization: `Bearer ${apiKey}` }),
    message: 'OpenAI API key tested',
  },
  claude: {
    url: ANTHROPIC_MODELS_URL,
    headers: (apiKey: string): Record<string, string> => ({
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    }),
    message: 'Claude API key tested',
  },
} as const;

async function testKey(
  mode: AiKeyMode,
  apiKey: string,
  opts: KeyTestOptions,
): Promise<AiKeyTestResponse> {
  const log = opts.log.child({ mod: 'ai' });
  const fetchImpl = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const provider = PROVIDERS[mode];
  const started = Date.now();
  let result: AiKeyTestResponse;
  let status: number | null = null;
  try {
    const response = await fetchImpl(provider.url, {
      method: 'GET',
      headers: provider.headers(apiKey),
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? AI_KEY_TEST_TIMEOUT_MS),
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
      provider: mode === 'claude' ? 'claude' : 'openai',
      ok: result.ok,
      error: result.error,
      status,
      ms: Date.now() - started,
    },
    provider.message,
  );
  return result;
}

/** Checks an Anthropic Claude API key with `GET /v1/models`; never stores or logs it. */
export function testClaudeKey(apiKey: string, opts: KeyTestOptions): Promise<AiKeyTestResponse> {
  return testKey('claude', apiKey, opts);
}

export function createAiKeyTester(opts: KeyTestOptions): AiKeyTester {
  return (apiKey, mode = 'api') => testKey(mode, apiKey, opts);
}
