import { createOpenAI } from '@ai-sdk/openai';
import { APICallError, defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from 'ai';

/**
 * We never store responses at OpenAI, so earlier items (reasoning, tool calls) must be resent in
 * full on each agent step: ask for encrypted reasoning instead of letting the SDK send an
 * `item_reference` to an id the server never kept (a 404 on the ChatGPT backend).
 */
const stateless = (model: Parameters<typeof wrapLanguageModel>[0]['model']) =>
  wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({
      settings: {
        providerOptions: {
          openai: { store: false, include: ['reasoning.encrypted_content'] },
        },
      },
    }),
  });

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** An OpenAI-shaped error the SDK turns into an APICallError carrying only our fixed message. */
const failed = (message: string, status: number) => json({ error: { message } }, status);

/**
 * API key mode: the public OpenAI Responses API. Redirects are refused, every request carries the
 * install's cache key, and upstream error bodies are never read or passed on.
 */
export function openAiKeyModel(options: {
  apiKey: string;
  modelId: string;
  cacheKey?: string;
  fetch?: typeof fetch;
}): LanguageModel {
  const send = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const adapter = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = withInstructions(
      JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    );
    if (options.cacheKey) body.prompt_cache_key = options.cacheKey;
    // A reply cancelled before the request left (e.g. a teammate took the chat) never sends it.
    init?.signal?.throwIfAborted();
    let response: Response;
    try {
      response = await send(url, { ...init, body: JSON.stringify(body), redirect: 'error' });
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      return failed('OpenAI could not answer. Check your connection and API settings.', 503);
    }
    if (!response.ok) {
      // Do not read the body: upstream errors can echo credentials or customer content.
      await response.body?.cancel().catch(() => {});
      return failed(
        response.status === 401
          ? 'The OpenAI API key was rejected.'
          : response.status === 429
            ? 'OpenAI usage limit reached. Check your account or try again later.'
            : 'OpenAI could not answer. Check your API settings.',
        response.status,
      );
    }
    const result = (await response.json()) as { status?: unknown };
    if (result.status !== 'completed') return failed('OpenAI did not complete its answer.', 502);
    return json(result, 200);
  }) as typeof fetch;
  return stateless(
    createOpenAI({ apiKey: options.apiKey, fetch: adapter }).responses(options.modelId),
  );
}

/** Request fields the ChatGPT route rejects (it streams, stores nothing and fixes sampling). */
const REJECTED_FIELDS = [
  'max_output_tokens',
  'temperature',
  'top_p',
  'top_logprobs',
  'metadata',
  'user',
  'truncation',
  'previous_response_id',
  'prompt_cache_retention',
  'safety_identifier',
  'background',
  'conversation',
  'service_tier',
];

type InputItem = { role?: string; content?: unknown };
const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: { text?: unknown }) => String(part?.text ?? '')).join('\n')
      : '';

/**
 * The SDK sends the system prompt as a `system` message; put it in the `instructions` field, as
 * our cache-friendly layout expects (and the ChatGPT route requires: it rejects `system` items).
 */
export function withInstructions(sdkBody: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...sdkBody };
  const input = Array.isArray(body.input) ? (body.input as InputItem[]) : [];
  const leading = input.filter((item) => item.role === 'system' || item.role === 'developer');
  if (!leading.length) return body;
  body.instructions = [typeof body.instructions === 'string' ? body.instructions : '']
    .concat(leading.map((item) => textOf(item.content)))
    .filter(Boolean)
    .join('\n');
  body.input = input.filter((item) => item.role !== 'system' && item.role !== 'developer');
  return body;
}

/**
 * Rewrites an AI SDK Responses request for the ChatGPT backend: streamed, `store: false`, no
 * rejected fields, and the system/developer text moved into `instructions` (which it requires).
 */
export function codexRequestBody(
  sdkBody: Record<string, unknown>,
  cacheKey?: string,
): Record<string, unknown> {
  const body = withInstructions(sdkBody);
  for (const field of REJECTED_FIELDS) delete body[field];
  body.stream = true;
  body.store = false;
  if (cacheKey) body.prompt_cache_key = cacheKey;
  return body;
}

/**
 * ChatGPT sign-in mode on the AI SDK: the standard OpenAI Responses provider whose requests go
 * through `send`, the ChatGPT client's own call (token refresh, 60 s bound, blocked state), which
 * returns the final response object read from the event stream.
 */
export function chatGptModel(options: {
  modelId: string;
  cacheKey?: string;
  send: (body: Record<string, unknown>, signal: AbortSignal) => Promise<Record<string, unknown>>;
}): LanguageModel {
  const adapter = (async (_url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal ?? new AbortController().signal;
    const body = codexRequestBody(
      JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      options.cacheKey,
    );
    try {
      return json(await options.send(body, signal), 200);
    } catch (error) {
      if (signal.aborted) throw error;
      // The client's errors carry fixed, user-facing messages (never upstream bodies).
      const status = (error as { status?: unknown }).status;
      return failed(
        error instanceof Error ? error.message : 'ChatGPT could not answer.',
        typeof status === 'number' && status >= 400 ? status : 502,
      );
    }
  }) as typeof fetch;
  return stateless(
    createOpenAI({
      apiKey: 'chatgpt-sign-in',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      fetch: adapter,
    }).responses(options.modelId),
  );
}

/**
 * The error a failed agent turn reports: our adapters' fixed messages pass through; a malformed or
 * missing decision becomes `invalid`; anything else the generic message. Never upstream text.
 */
export function agentFailure(error: unknown, invalid: string, generic: string): Error {
  // Only our adapters answer with an error status; anything else (e.g. an unreadable success
  // response) means the answer itself was unusable.
  if (APICallError.isInstance(error))
    return new Error((error.statusCode ?? 0) >= 400 ? error.message : invalid);
  const name = (error as { name?: unknown } | null)?.name;
  if (
    typeof name === 'string' &&
    /NoObjectGenerated|NoOutputGenerated|TypeValidation|JSONParse|ZodError/.test(name)
  )
    return new Error(invalid);
  return new Error(generic);
}
