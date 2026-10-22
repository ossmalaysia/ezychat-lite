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
  let providerError: string | null = null;
  try {
    const response = await fetchImpl(provider.url, {
      method: 'GET',
      headers: provider.headers(apiKey),
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? AI_KEY_TEST_TIMEOUT_MS),
    });
    status = response.status;
    // A 400 means the service answered but refused (e.g. Anthropic's "credit balance is too low"):
    // read only its short error object, which never echoes the key. Otherwise the body is not needed.
    const refusal = status === 400 ? await readRefusal(response) : null;
    if (!refusal) await response.body?.cancel().catch(() => undefined);
    providerError = refusal?.type ?? null;
    if (response.ok) result = { ok: true, error: null };
    else if (refusal) result = { ok: false, error: refusal.noCredit ? 'no_credit' : 'rejected' };
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
      // The service's error type only (e.g. invalid_request_error), never its message or the key.
      ...(providerError ? { providerError } : {}),
      ms: Date.now() - started,
    },
    provider.message,
  );
  return result;
}

/** The largest refusal body read (Anthropic's and OpenAI's error objects are well below it). */
const REFUSAL_BYTES = 4_096;

/**
 * A 400 answer's error type and whether it is about credit (`{ error: { type, message } }`), or
 * null when the body is not such an object. The message is only matched, never kept or logged.
 */
async function readRefusal(
  response: Response,
): Promise<{ type: string | null; noCredit: boolean } | null> {
  try {
    const text = (await response.text()).slice(0, REFUSAL_BYTES);
    const error = (JSON.parse(text) as { error?: { type?: unknown; message?: unknown } }).error;
    if (!error || typeof error !== 'object') return { type: null, noCredit: false };
    const message = typeof error.message === 'string' ? error.message : '';
    return {
      type: typeof error.type === 'string' ? error.type.slice(0, 64) : null,
      noCredit: /credit balance|billing|purchase credits/i.test(message),
    };
  } catch {
    return { type: null, noCredit: false };
  }
}

/** Checks an Anthropic Claude API key with `GET /v1/models`; never stores or logs it. */
export function testClaudeKey(apiKey: string, opts: KeyTestOptions): Promise<AiKeyTestResponse> {
  return testKey('claude', apiKey, opts);
}

export function createAiKeyTester(opts: KeyTestOptions): AiKeyTester {
  return (apiKey, mode = 'api') => testKey(mode, apiKey, opts);
}
