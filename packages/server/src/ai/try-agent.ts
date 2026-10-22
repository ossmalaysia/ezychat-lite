import type { AiTryResult } from '@ezychat/shared';
import { AiTryBody } from '@ezychat/shared';
import type { AppContext } from '../context.js';
import { errors } from '../http/errors.js';

/**
 * Try it for extensions (e.g. "Try it with connectors"): one AI agent answer to a test question
 * with the SAVED setup, exactly like POST /api/ai/try. `agentId` names the agent (default: the
 * only agent, else the agent of inbox 1); `agent` stays `'sales'` for every agent. No chat, no message, no side effects; the
 * result lists the extension look-ups (names, ok, ms) and a hand-over outcome. Add your own
 * admin check and rate limit on the route that calls it.
 */
export async function tryAgentReply(
  ctx: AppContext,
  input: { agent: 'sales'; question: string; agentId?: number },
): Promise<AiTryResult> {
  const ai = ctx.services.ai;
  if (!ai) throw errors.validation('The AI is not available');
  const current =
    input.agentId === undefined ? ai.status().settings : ai.agentStatus(input.agentId).settings;
  const body = AiTryBody.safeParse({
    question: input.question,
    knowledge: {
      displayName: current.displayName,
      instructions: current.instructions,
      handoffRules: current.handoffRules ?? '',
    },
    ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
  });
  if (!body.success) throw errors.validation('Ask a question of at most 500 characters');
  return ai.tryAnswer(body.data);
}
