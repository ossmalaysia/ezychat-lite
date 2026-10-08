import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { AiPrompt } from '../provider-types.js';

const RewriteOutput = z.object({ text: z.string() });

export interface RewriteCall {
  model: LanguageModel;
  prompt: Pick<AiPrompt, 'instructions' | 'input'>;
  signal: AbortSignal;
}

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
    // Room for a full 8,000-character box (CJK can take ~1 token per character) plus reasoning.
    maxOutputTokens: 12_000,
  });
  call.signal.throwIfAborted();
  return RewriteOutput.parse(result.output);
}
