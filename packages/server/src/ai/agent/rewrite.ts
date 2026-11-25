import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { AiPrompt } from '../provider-types.js';
import { withReasoningHeadroom } from './draft.js';

const RewriteOutput = z.object({ text: z.string() });

export interface RewriteCall {
  model: LanguageModel;
  prompt: Pick<AiPrompt, 'instructions' | 'input' | 'reasoningEffort'>;
  signal: AbortSignal;
  /** The model reasons: its reasoning tokens count against the output cap, so the cap gets headroom. */
  reasons?: boolean;
}

/** Room for a full 8,000-character box (CJK can take ~1 token per character); a reasoning model gets headroom. */
export const REWRITE_MAX_OUTPUT_TOKENS = 12_000;

/** Edit with AI: one model call, no tools, returning the full suggested text of one setting. */
export async function runRewrite(call: RewriteCall): Promise<{ text: string }> {
  call.signal.throwIfAborted();
  const result = await generateText({
    model: call.model,
    instructions: call.prompt.instructions,
    messages: [{ role: 'user', content: [{ type: 'text', text: call.prompt.input }] }],
    output: Output.object({ schema: RewriteOutput }),
    abortSignal: call.signal,
    // Never retry silently: a retry costs the business's usage; the admin can ask again.
    maxRetries: 0,
    maxOutputTokens: withReasoningHeadroom(
      REWRITE_MAX_OUTPUT_TOKENS,
      call.reasons,
      call.prompt.reasoningEffort,
    ),
    ...(call.prompt.reasoningEffort
      ? { providerOptions: { openai: { reasoningEffort: call.prompt.reasoningEffort } } }
      : {}),
  });
  call.signal.throwIfAborted();
  return RewriteOutput.parse(result.output);
}
