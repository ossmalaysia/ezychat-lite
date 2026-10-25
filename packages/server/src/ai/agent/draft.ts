import { generateText, Output, type LanguageModel } from 'ai';
import type { z } from 'zod';
import type { AiSettings } from '@ezychat/shared';
import type { AiRewritePrompt } from '../provider-types.js';

/**
 * Completions must arrive while the teammate still types (the server drops them after 3 s), so
 * they use a fast model of the saved provider. OpenAI: the app's small default model (the same
 * value as `OPENAI_DEFAULT_MODEL`, not imported to keep provider.ts → agent/* one-way). ChatGPT
 * sign-in keeps the saved model: its model list depends on the account.
 */
export const DRAFT_FAST_MODELS = { api: 'gpt-4.1-mini', claude: 'claude-haiku-5-5' } as const;

/** The settings a draft call uses: the fast model for a completion in API-key modes. */
export function draftModelSettings<T extends Pick<AiSettings, 'mode' | 'model'>>(
  settings: T,
  fast: boolean,
): T {
  if (!fast || settings.mode === 'chatgpt') return settings;
  return { ...settings, model: DRAFT_FAST_MODELS[settings.mode] };
}

export interface DraftCall<T> {
  model: LanguageModel;
  prompt: AiRewritePrompt;
  schema: z.ZodType<T>;
  signal: AbortSignal;
  maxOutputTokens: number;
}

/** Reply suggestions and completions: one structured call, no tools, never retried. */
export async function runDraft<T>(call: DraftCall<T>): Promise<T> {
  call.signal.throwIfAborted();
  const result = await generateText({
    model: call.model,
    instructions: call.prompt.instructions,
    messages: [{ role: 'user', content: [{ type: 'text', text: call.prompt.input }] }],
    output: Output.object({ schema: call.schema }),
    abortSignal: call.signal,
    // A retry costs the business's usage; the teammate can press Suggest reply again.
    maxRetries: 0,
    maxOutputTokens: call.maxOutputTokens,
  });
  call.signal.throwIfAborted();
  return call.schema.parse(result.output);
}
