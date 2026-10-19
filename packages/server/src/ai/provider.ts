import type { LanguageModel } from 'ai';
import type { AiDecision, AiSettings, EnrichmentExtraction } from '@ezychat/shared';
import { runCustomerExtraction } from './agent/extract-customer.js';
import { AgentTurnFailure, agentFailure, errorNameOf, openAiKeyModel } from './agent/models.js';
import { runRewrite } from './agent/rewrite.js';
import { runAgentTurn } from './agent/turn.js';
import { promptCacheKey } from './prompt.js';
import type { AiPrompt, AiRewritePrompt } from './provider-types.js';

export const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';

export function extractCustomerOpenAi(
  settings: AiSettings,
  apiKey: string | null,
  prompt: AiRewritePrompt,
  signal: AbortSignal,
): Promise<EnrichmentExtraction> {
  return withOpenAiKey(settings, apiKey, prompt.cacheId, signal, async (model, _id, bounded) =>
    runCustomerExtraction({ model, prompt, signal: bounded }),
  );
}

const aborted = () => new DOMException('AI reply cancelled', 'AbortError');

/** API key mode: one call on the public OpenAI Responses API, bounded to 60 s. */
async function withOpenAiKey<T>(
  settings: AiSettings,
  apiKey: string | null,
  cacheId: string | undefined,
  signal: AbortSignal,
  run: (model: LanguageModel, modelId: string, bounded: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!apiKey) throw new Error('Add an OpenAI API key in the AI member settings.');
  signal.throwIfAborted();
  const modelId = settings.model || OPENAI_DEFAULT_MODEL;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  try {
    const model = openAiKeyModel({
      apiKey,
      modelId,
      cacheKey: cacheId ? promptCacheKey(cacheId, modelId) : undefined,
    });
    return await run(model, modelId, bounded);
  } catch (error) {
    if (signal.aborted) throw aborted();
    if (bounded.aborted)
      throw new AgentTurnFailure('OpenAI answer timed out.', 'timeout', errorNameOf(error));
    throw agentFailure(
      error,
      'The AI returned an invalid answer.',
      'OpenAI could not answer. Check your API settings.',
    );
  }
}

/** API key mode: one agent turn (all steps share the 60 s bound). */
export function generateOpenAi(
  settings: AiSettings,
  apiKey: string | null,
  prompt: AiPrompt,
  signal: AbortSignal,
): Promise<AiDecision> {
  return withOpenAiKey(settings, apiKey, prompt.cacheId, signal, async (model, _id, bounded) => {
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

/** API key mode: Edit with AI's single rewrite call. */
export function rewriteOpenAi(
  settings: AiSettings,
  apiKey: string | null,
  prompt: AiRewritePrompt,
  signal: AbortSignal,
): Promise<{ text: string; model: string }> {
  return withOpenAiKey(settings, apiKey, prompt.cacheId, signal, async (model, id, bounded) => ({
    ...(await runRewrite({ model, prompt, signal: bounded })),
    model: id,
  }));
}
