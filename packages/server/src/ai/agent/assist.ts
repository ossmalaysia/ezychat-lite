import {
  generateText,
  NoObjectGeneratedError,
  Output,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { z } from 'zod';

/** Ask Ezy: at most this many model calls per question (tool calls + the final answer). */
export const ASSIST_MAX_STEPS = 8;
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
  'question',
  'agent_proposal',
  'task_proposal',
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
  /** The answer was taken out of extra text around it (see `answerFromText`). */
  repaired?: true;
}

const ANSWER_START = /\{\s*"text"\s*:/g;

/**
 * The last complete answer object inside a text the format check refused, else null. The model sometimes writes a
 * valid answer and then more (a second copy, a closing sentence); the AI SDK reads it all as one JSON value.
 */
export function answerFromText(text: string): AssistOutput | null {
  const starts = [...text.matchAll(ANSWER_START)].map((m) => m.index).reverse();
  for (const start of starts) {
    for (let end = text.indexOf('}', start); end >= 0; end = text.indexOf('}', end + 1)) {
      let value: unknown;
      try {
        value = JSON.parse(text.slice(start, end + 1));
      } catch {
        continue;
      }
      const parsed = AssistOutput.safeParse(value);
      if (parsed.success) return parsed.data;
      break;
    }
  }
  return null;
}

/** One Ask Ezy turn: read tools, then a structured answer. Never retried (a retry costs usage). */
export async function runAssist(call: AssistCall): Promise<AssistResult> {
  call.signal.throwIfAborted();
  const toolCalls: string[] = [];
  let steps = 0;
  let answer: AssistResult;
  try {
    const result = await generate(call, (names) => {
      steps++;
      toolCalls.push(...names);
    });
    answer = {
      output: AssistOutput.parse(result.output),
      toolCalls: result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)),
      steps: result.steps.length,
    };
  } catch (error) {
    const text = NoObjectGeneratedError.isInstance(error) ? error.text : undefined;
    const output = text ? answerFromText(text) : null;
    if (!output || call.signal.aborted) throw error;
    answer = { output, toolCalls, steps, repaired: true };
  }
  call.signal.throwIfAborted();
  return answer;
}

function generate(call: AssistCall, onStepNames: (names: string[]) => void) {
  return generateText({
    model: call.model,
    instructions: call.instructions,
    messages: call.messages,
    tools: call.tools,
    stopWhen: stepCountIs(ASSIST_MAX_STEPS),
    // The last step may not call a tool: a tool call there leaves no answer (`NoOutputGeneratedError`).
    prepareStep: ({ stepNumber }) =>
      stepNumber === ASSIST_MAX_STEPS - 1 ? { toolChoice: 'none' } : undefined,
    output: Output.object({ schema: AssistOutput }),
    abortSignal: call.signal,
    maxRetries: 0,
    maxOutputTokens: ASSIST_MAX_OUTPUT_TOKENS,
    onStepFinish: (step) => {
      const names = step.toolCalls.map((c) => c.toolName);
      onStepNames(names);
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
}
