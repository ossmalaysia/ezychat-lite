import { AI_MODEL_HANDOFF_REASONS, AiDecision, type AiSettings } from '@wa-team-inbox/shared';
import { promptCacheKey } from './prompt.js';
import type { AiPrompt } from './provider-types.js';

export const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';

export const AI_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    action: { type: 'string', enum: ['answer', 'ask_resolution', 'resolve', 'handoff'] },
    handoffReason: {
      type: ['string', 'null'],
      enum: [...AI_MODEL_HANDOFF_REASONS, null],
    },
  },
  required: ['reply', 'action', 'handoffReason'],
  additionalProperties: false,
};

function parseDecision(value: string) {
  try {
    return AiDecision.parse(JSON.parse(value));
  } catch {
    throw new Error('The AI returned an invalid answer.');
  }
}

const aborted = () => new DOMException('AI reply cancelled', 'AbortError');

export async function generateOpenAi(
  settings: AiSettings,
  apiKey: string | null,
  prompt: AiPrompt,
  signal: AbortSignal,
): Promise<AiDecision> {
  if (!apiKey) throw new Error('Add an OpenAI API key in the AI member settings.');
  signal.throwIfAborted();
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const model = settings.model || OPENAI_DEFAULT_MODEL;
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      redirect: 'error',
      signal: boundedSignal,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions: prompt.instructions,
        input: prompt.input,
        // Responses API prefix caching is automatic; a stable key routes this inbox's requests together.
        ...(prompt.cacheId ? { prompt_cache_key: promptCacheKey(prompt.cacheId, model) } : {}),
        store: false,
        tools: [],
        text: {
          format: {
            type: 'json_schema',
            name: 'business_reply',
            strict: true,
            schema: AI_OUTPUT_SCHEMA,
          },
        },
        max_output_tokens: 2000,
      }),
    });
  } catch {
    if (signal.aborted) throw aborted();
    throw new Error('OpenAI could not answer. Check your connection and API settings.');
  }
  if (!response.ok) {
    // Do not include the body: upstream errors can echo credentials or customer content.
    await response.body?.cancel().catch(() => {});
    throw new Error(
      response.status === 401
        ? 'The OpenAI API key was rejected.'
        : response.status === 429
          ? 'OpenAI usage limit reached. Check your account or try again later.'
          : 'OpenAI could not answer. Check your API settings.',
    );
  }
  let result: {
    status?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  try {
    result = (await response.json()) as typeof result;
  } catch {
    throw new Error('OpenAI returned an invalid answer.');
  }
  signal.throwIfAborted();
  if (result.status !== 'completed') throw new Error('OpenAI did not complete its answer.');
  const text = result.output
    ?.filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('');
  return parseDecision(text ?? '');
}
