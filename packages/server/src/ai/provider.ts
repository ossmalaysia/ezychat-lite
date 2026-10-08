import type { AiDecision, AiSettings } from '@wa-team-inbox/shared';
import { agentFailure, openAiKeyModel } from './agent/models.js';
import { runAgentTurn } from './agent/turn.js';
import { promptCacheKey } from './prompt.js';
import type { AiPrompt } from './provider-types.js';

export const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';

const aborted = () => new DOMException('AI reply cancelled', 'AbortError');

/** API key mode: one agent turn on the public OpenAI Responses API, bounded to 60 s. */
export async function generateOpenAi(
  settings: AiSettings,
  apiKey: string | null,
  prompt: AiPrompt,
  signal: AbortSignal,
): Promise<AiDecision> {
  if (!apiKey) throw new Error('Add an OpenAI API key in the AI member settings.');
  signal.throwIfAborted();
  const model = settings.model || OPENAI_DEFAULT_MODEL;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  try {
    const turn = await runAgentTurn({
      model: openAiKeyModel({
        apiKey,
        modelId: model,
        cacheKey: prompt.cacheId ? promptCacheKey(prompt.cacheId, model) : undefined,
      }),
      prompt,
      tools: prompt.tools,
      signal: bounded,
    });
    return turn.decision;
  } catch (error) {
    if (signal.aborted) throw aborted();
    if (bounded.aborted) throw new Error('OpenAI answer timed out.', { cause: error });
    throw agentFailure(
      error,
      'The AI returned an invalid answer.',
      'OpenAI could not answer. Check your API settings.',
    );
  }
}
