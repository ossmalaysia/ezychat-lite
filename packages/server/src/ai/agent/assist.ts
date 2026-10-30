import { generateText, Output, stepCountIs, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { z } from 'zod';

/** Ask Ezy: at most this many model calls per question (tool calls + the final answer). */
export const ASSIST_MAX_STEPS = 6;
export const ASSIST_MAX_OUTPUT_TOKENS = 3000;

/** Block types the model may fill; the server checks each against `AskEzyBlock` and drops the rest. */
export const ASSIST_BLOCK_TYPES = [
  'stats',
  'bars',
  'heatmap',
  'chats',
  'customer',
  'change',
  'test',
] as const;

/**
 * What the model returns (strict-schema friendly: every field present). A block's content is a JSON string,
 * so one flat schema covers every block type; `change` blocks carry only the id a
 * `propose_ai_setup_change` call returned (the server fills in the card).
 */
export const AssistOutput = z.object({
  text: z.string(),
  blocks: z.array(z.object({ type: z.enum(ASSIST_BLOCK_TYPES), json: z.string() })),
  followUps: z.array(z.string()),
});
export type AssistOutput = z.infer<typeof AssistOutput>;

export interface AssistCall {
  model: LanguageModel;
  instructions: string;
  messages: ModelMessage[];
  tools: ToolSet;
  signal: AbortSignal;
  /** Receives the tool names of each finished step (for the live "Read …" lines). */
  onStep?: (toolNames: string[]) => void;
  /** OpenAI Responses reasoning effort for ChatGPT sign-in; omitted = the model's default. */
  reasoningEffort?: 'low';
}

export interface AssistResult {
  output: AssistOutput;
  /** Tool names in call order (for the log and the "Ezy read" line), never inputs or outputs. */
  toolCalls: string[];
  steps: number;
}

/** One Ask Ezy turn: read tools, then a structured answer. Never retried (a retry costs usage). */
export async function runAssist(call: AssistCall): Promise<AssistResult> {
  call.signal.throwIfAborted();
  const result = await generateText({
    model: call.model,
    instructions: call.instructions,
    messages: call.messages,
    tools: call.tools,
    stopWhen: stepCountIs(ASSIST_MAX_STEPS),
    output: Output.object({ schema: AssistOutput }),
    abortSignal: call.signal,
    maxRetries: 0,
    maxOutputTokens: ASSIST_MAX_OUTPUT_TOKENS,
    onStepFinish: (step) => {
      const names = step.toolCalls.map((c) => c.toolName);
      if (names.length) {
        try {
          call.onStep?.(names);
        } catch {
          // progress only; never changes the answer
        }
      }
    },
    ...(call.reasoningEffort
      ? { providerOptions: { openai: { reasoningEffort: call.reasoningEffort } } }
      : {}),
  });
  call.signal.throwIfAborted();
  return {
    output: AssistOutput.parse(result.output),
    toolCalls: result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)),
    steps: result.steps.length,
  };
}
