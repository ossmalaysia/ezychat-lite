import { createAnthropic } from '@ai-sdk/anthropic';
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from 'ai';
import {
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_MODELS,
  type AiDecision,
  type AiSettings,
  type EnrichmentExtraction,
} from '@ezychat/shared';
import { runCustomerExtraction } from './agent/extract-customer.js';
import { AgentTurnFailure, agentFailure, errorNameOf } from './agent/models.js';
import { draftModelSettings, runDraft } from './agent/draft.js';
import { runRewrite } from './agent/rewrite.js';
import { runAgentTurn } from './agent/turn.js';
import { runAssist } from './agent/assist.js';
import type { AiAssistCall, AiDraftOptions, AiPrompt, AiRewritePrompt } from './provider-types.js';

/**
 * The public Anthropic Messages API. Fixed here (never `ANTHROPIC_BASE_URL` from the environment),
 * so the saved key only ever goes to Anthropic. This is the only file that imports
 * `@ai-sdk/anthropic`.
 */
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1';
/** Thinking effort for every Claude call (see `claudeKeyModel`). */
export const CLAUDE_EFFORT = 'low';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** An Anthropic-shaped error the SDK turns into an APICallError carrying only our fixed message. */
const failed = (message: string, status: number) =>
  json({ type: 'error', error: { type: 'api_error', message } }, status);

/** Our fixed message for an Anthropic error status (the upstream body is never read). */
function statusMessage(status: number): string {
  if (status === 401 || status === 403) return 'The Claude API key was rejected.';
  if (status === 429) return 'Claude usage limit reached. Check your account or try again later.';
  if (status === 529) return 'Claude is overloaded right now. Try again later.';
  return 'Claude could not answer. Check your API settings.';
}

type Prompt = Parameters<
  NonNullable<LanguageModelMiddleware['transformParams']>
>[0]['params']['prompt'];
type PromptMessage = Prompt[number];

/**
 * Marks the system prompt (GUARDRAILS … hand-over rules: the static part of our layout) as a
 * prompt-cache breakpoint, and drops options meant for another provider (e.g. OpenAI's image
 * `detail`) so they can never reach Anthropic. The input JSON stays the last user content.
 */
export function forClaude(prompt: Prompt): Prompt {
  const lastSystem = prompt.map((message) => message.role).lastIndexOf('system');
  return prompt.map((message, index): PromptMessage => {
    const own = <T extends { providerOptions?: Record<string, unknown> }>(item: T): T => {
      if (!item.providerOptions) return item;
      const { anthropic } = item.providerOptions;
      const rest = { ...item };
      delete rest.providerOptions;
      return anthropic ? ({ ...rest, providerOptions: { anthropic } } as T) : rest;
    };
    if (message.role === 'system') {
      const base = own(message);
      if (index !== lastSystem) return base;
      return {
        ...base,
        providerOptions: {
          anthropic: {
            ...(base.providerOptions?.anthropic ?? {}),
            cacheControl: { type: 'ephemeral' },
          },
        },
      } as PromptMessage;
    }
    return {
      ...own(message),
      content: (message.content as Array<{ providerOptions?: Record<string, unknown> }>).map(own),
    } as PromptMessage;
  });
}

/**
 * Claude API key mode: the Anthropic Messages API. Redirects are refused, the request is never
 * sent once cancelled, and upstream error bodies are never read or passed on (they can echo
 * credentials or customer content).
 */
export function claudeKeyModel(options: {
  apiKey: string;
  modelId: string;
  fetch?: typeof fetch;
}): LanguageModel {
  const send = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const adapter = (async (url: string | URL | Request, init?: RequestInit) => {
    // A reply cancelled before the request left (e.g. a teammate took the chat) never sends it.
    init?.signal?.throwIfAborted();
    let response: Response;
    try {
      response = await send(url, { ...init, redirect: 'error' });
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      return failed('Claude could not answer. Check your connection and API settings.', 503);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return failed(statusMessage(response.status), response.status);
    }
    return response;
  }) as typeof fetch;
  return wrapLanguageModel({
    model: createAnthropic({
      apiKey: options.apiKey,
      baseURL: ANTHROPIC_API_URL,
      fetch: adapter,
    })(options.modelId),
    middleware: {
      specificationVersion: 'v4',
      transformParams: async ({ params }) => ({
        ...params,
        prompt: forClaude(params.prompt),
        // Only Anthropic options reach Anthropic. Claude 5.5 models always think, and thinking
        // counts toward our output caps (2,000 tokens for a reply): low effort keeps the answer
        // inside them and fast enough for chat.
        providerOptions: {
          anthropic: { effort: CLAUDE_EFFORT, ...(params.providerOptions?.anthropic ?? {}) },
        },
      }),
    },
  });
}

/** The saved model when it is a Claude model, else the default ('' = default). */
export function claudeModelId(settings: Pick<AiSettings, 'model'>): string {
  return (CLAUDE_MODELS as readonly string[]).includes(settings.model)
    ? settings.model
    : CLAUDE_DEFAULT_MODEL;
}

const aborted = () => new DOMException('AI reply cancelled', 'AbortError');

/** Claude API key mode: one call (or agent turn) bounded to 60 s, with fixed error messages. */
async function withClaudeKey<T>(
  settings: AiSettings,
  apiKey: string | null,
  signal: AbortSignal,
  run: (model: LanguageModel, modelId: string, bounded: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!apiKey) throw new Error('Add a Claude API key in Settings → AI.');
  signal.throwIfAborted();
  const modelId = claudeModelId(settings);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  try {
    return await run(claudeKeyModel({ apiKey, modelId }), modelId, bounded);
  } catch (error) {
    if (signal.aborted) throw aborted();
    if (bounded.aborted)
      throw new AgentTurnFailure('Claude answer timed out.', 'timeout', errorNameOf(error));
    throw agentFailure(
      error,
      'The AI returned an invalid answer.',
      'Claude could not answer. Check your API settings.',
    );
  }
}

/** Claude API key mode: one agent turn (all steps share the 60 s bound). */
export function generateClaude(
  settings: AiSettings,
  apiKey: string | null,
  prompt: AiPrompt,
  signal: AbortSignal,
): Promise<AiDecision> {
  return withClaudeKey(settings, apiKey, signal, async (model, _id, bounded) => {
    const turn = await runAgentTurn({
      model,
      prompt,
      tools: prompt.tools,
      signal: bounded,
      onTiming: prompt.onTiming,
    });
    return turn.decision;
  });
}

/** Claude API key mode: customer enrichment's single extraction call. */
export function extractCustomerClaude(
  settings: AiSettings,
  apiKey: string | null,
  prompt: AiRewritePrompt,
  signal: AbortSignal,
): Promise<EnrichmentExtraction> {
  return withClaudeKey(settings, apiKey, signal, (model, _id, bounded) =>
    runCustomerExtraction({ model, prompt, signal: bounded }),
  );
}

/** Claude API key mode: one reply-draft call (completions use the fast model). */
/** Claude key mode: one Ask Ezy turn (all steps share the 60 s bound). */
export function assistClaude(
  settings: AiSettings,
  apiKey: string | null,
  call: AiAssistCall,
  signal: AbortSignal,
) {
  return withClaudeKey(settings, apiKey, signal, async (model, id, bounded) => ({
    ...(await runAssist({ ...call, model, signal: bounded })),
    model: id,
  }));
}

export function draftClaude<T>(
  settings: AiSettings,
  apiKey: string | null,
  prompt: AiRewritePrompt,
  options: AiDraftOptions<T>,
  signal: AbortSignal,
): Promise<{ output: T; model: string }> {
  return withClaudeKey(
    draftModelSettings(settings, options.fast),
    apiKey,
    signal,
    async (model, id, bounded) => ({
      output: await runDraft({ ...options, model, prompt, signal: bounded }),
      model: id,
    }),
  );
}

/** Claude API key mode: Edit with AI's single rewrite call. */
export function rewriteClaude(
  settings: AiSettings,
  apiKey: string | null,
  prompt: AiRewritePrompt,
  signal: AbortSignal,
): Promise<{ text: string; model: string }> {
  return withClaudeKey(settings, apiKey, signal, async (model, id, bounded) => ({
    ...(await runRewrite({ model, prompt, signal: bounded })),
    model: id,
  }));
}
