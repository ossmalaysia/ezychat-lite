import { generateText, Output, type LanguageModel } from 'ai';
import { EnrichmentExtraction } from '@wa-team-inbox/shared';
import type { AiRewritePrompt } from '../provider-types.js';

/** One bounded, tool-free extraction call. The customer service guards every proposed write. */
export async function runCustomerExtraction(call: {
  model: LanguageModel;
  prompt: AiRewritePrompt;
  signal: AbortSignal;
}): Promise<EnrichmentExtraction> {
  call.signal.throwIfAborted();
  const result = await generateText({
    model: call.model,
    instructions: call.prompt.instructions,
    messages: [{ role: 'user', content: [{ type: 'text', text: call.prompt.input }] }],
    output: Output.object({ schema: EnrichmentExtraction }),
    abortSignal: call.signal,
    maxRetries: 0,
    maxOutputTokens: 4000,
  });
  call.signal.throwIfAborted();
  return EnrichmentExtraction.parse(result.output);
}
