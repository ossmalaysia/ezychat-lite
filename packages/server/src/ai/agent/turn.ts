import { generateText, Output, stepCountIs, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import { AI_MODEL_HANDOFF_REASONS, AiDecision } from '@wa-team-inbox/shared';
import { relevantKnowledge, type KnowledgeSource } from '../knowledge.js';
import type { AiPrompt } from '../provider-types.js';

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
  /** This AI member's business context; the search tool reads only this. */
  knowledge: readonly KnowledgeSource[];
  /** The chat being answered. Tools receive it from the server, never from the model. */
  chatJid: string;
  signal: AbortSignal;
  /** Provider-specific options (e.g. OpenAI `store: false`, `promptCacheKey`). */
  providerOptions?: Parameters<typeof generateText>[0]['providerOptions'];
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
  const tools = {
    search_business_context: tool({
      description:
        "Search the business's own facts (products, prices, hours, delivery, policies). " +
        'Call it before answering any question about the business; search again with other words if needed.',
      inputSchema: z.object({ query: z.string().min(1).max(200) }),
      execute: async ({ query }) => relevantKnowledge([...turn.knowledge], query),
    }),
  };
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
          })),
        ],
      },
    ],
    tools,
    stopWhen: stepCountIs(AGENT_MAX_STEPS),
    output: Output.object({ schema: DecisionOutput }),
    abortSignal: turn.signal,
    providerOptions: turn.providerOptions,
  });
  turn.signal.throwIfAborted();
  return {
    decision: AiDecision.parse(result.output),
    toolCalls: result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
    steps: result.steps.length,
  };
}
