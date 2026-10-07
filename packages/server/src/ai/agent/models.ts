import { randomUUID } from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from 'ai';
import { backendHeaders, CODEX_BACKEND, parseSse, type BackendAuth } from '../chatgpt-backend.js';

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

/** API key mode: the public OpenAI Responses API. */
export function openAiKeyModel(apiKey: string, modelId: string): LanguageModel {
  return stateless(createOpenAI({ apiKey }).responses(modelId));
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
 * Rewrites an AI SDK Responses request for the ChatGPT backend: streamed, `store: false`, no
 * rejected fields, and the system/developer text moved into `instructions` (which it requires).
 */
export function codexRequestBody(
  sdkBody: Record<string, unknown>,
  cacheKey?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...sdkBody };
  for (const field of REJECTED_FIELDS) delete body[field];
  const input = Array.isArray(body.input) ? (body.input as InputItem[]) : [];
  const leading = input.filter((item) => item.role === 'system' || item.role === 'developer');
  const rules = [typeof body.instructions === 'string' ? body.instructions : '']
    .concat(leading.map((item) => textOf(item.content)))
    .filter(Boolean)
    .join('\n');
  body.input = input.filter((item) => item.role !== 'system' && item.role !== 'developer');
  body.instructions = rules;
  body.stream = true;
  body.store = false;
  if (cacheKey) body.prompt_cache_key = cacheKey;
  return body;
}

/** Reads a Responses event stream to the end and returns the final response object. */
export async function collectStreamedResponse(
  stream: ReadableStream<Uint8Array>,
): Promise<Record<string, unknown>> {
  const items: unknown[] = [];
  for await (const event of parseSse(stream)) {
    switch (event.type) {
      case 'response.output_item.done':
        items.push(event.item);
        break;
      case 'error':
      case 'response.failed':
        throw new Error('ChatGPT could not answer.');
      case 'response.completed':
      case 'response.done':
      case 'response.incomplete': {
        const response = { ...(event.response as Record<string, unknown>) };
        // The Codex stream reports items one by one; its final event may carry an empty list.
        const output = Array.isArray(response.output) ? response.output : [];
        response.output = output.length ? output : items;
        return response;
      }
    }
  }
  throw new Error('ChatGPT ended the answer early.');
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * ChatGPT sign-in mode on the AI SDK: the standard OpenAI Responses provider, with a fetch that
 * signs the request, sends it streamed to the ChatGPT backend and hands the SDK the final response.
 */
export function chatGptModel(options: {
  modelId: string;
  auth: () => Promise<BackendAuth>;
  cacheKey?: string;
  fetch?: typeof fetch;
}): LanguageModel {
  const send = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sessionId = randomUUID();
  const adapter = (async (_url: string | URL | Request, init?: RequestInit) => {
    const auth = await options.auth();
    const body = codexRequestBody(
      JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      options.cacheKey,
    );
    const response = await send(CODEX_BACKEND.responsesUrl, {
      method: 'POST',
      headers: backendHeaders(auth, sessionId),
      body: JSON.stringify(body),
      signal: init?.signal,
    });
    if (!response.ok || !response.body) {
      // Never pass the upstream body on: it can echo credentials or customer content.
      await response.body?.cancel().catch(() => {});
      return json(
        { error: { message: `ChatGPT request failed (${response.status}).` } },
        response.status || 502,
      );
    }
    return json(await collectStreamedResponse(response.body), 200);
  }) as typeof fetch;
  return stateless(
    createOpenAI({
      apiKey: 'chatgpt-sign-in',
      baseURL: CODEX_BACKEND.responsesUrl.replace(/\/responses$/, ''),
      fetch: adapter,
    }).responses(options.modelId),
  );
}
