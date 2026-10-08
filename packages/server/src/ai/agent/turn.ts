import { generateText, Output, stepCountIs, type LanguageModel, type ToolSet } from 'ai';
import { z } from 'zod';
import { AI_MODEL_HANDOFF_REASONS, AiDecision } from '@wa-team-inbox/shared';
import { AI_IMAGE_DETAIL, type AiPrompt } from '../provider-types.js';

/** At most this many model calls per customer turn (tool calls + the final decision). */
export const AGENT_MAX_STEPS = 4;

/** The structured decision, strict-schema friendly (every field present; null when unused). */
const DecisionOutput = z.object({
  reply: z.string(),
  action: AiDecision.shape.action,
  handoffReason: z.enum(AI_MODEL_HANDOFF_REASONS).nullable(),
});

export interface AgentTurn {
  model: LanguageModel;
  prompt: Pick<AiPrompt, 'instructions' | 'input' | 'images'>;
  /** Read tools already bound to this chat by the server (see `agent/tools.ts`); none is fine. */
  tools?: ToolSet;
  signal: AbortSignal;
}

export interface AgentTurnResult {
  decision: AiDecision;
  /** Tool names in call order, for the decision log (never their inputs or outputs). */
  toolCalls: string[];
  steps: number;
}

/**
 * One customer turn on the AI SDK agent loop: the model may call read tools, then must return the
 * decision. The server still decides what happens with it (model proposes, code decides).
 */
export async function runAgentTurn(turn: AgentTurn): Promise<AgentTurnResult> {
  turn.signal.throwIfAborted();
  const result = await generateText({
    model: turn.model,
    instructions: turn.prompt.instructions,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: turn.prompt.input },
          ...(turn.prompt.images ?? []).map((image) => ({
            type: 'image' as const,
            image: image.base64,
            mediaType: image.mime,
            providerOptions: { openai: { imageDetail: AI_IMAGE_DETAIL } },
          })),
        ],
      },
    ],
    tools: turn.tools ?? {},
    stopWhen: stepCountIs(AGENT_MAX_STEPS),
    output: Output.object({ schema: DecisionOutput }),
    abortSignal: turn.signal,
    // Never retry silently: a retry costs the business's usage and delays the reply; the service
    // hands the chat to the team instead.
    maxRetries: 0,
    maxOutputTokens: 2000,
  });
  turn.signal.throwIfAborted();
  return {
    decision: AiDecision.parse(result.output),
    toolCalls: result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
    steps: result.steps.length,
  };
}
