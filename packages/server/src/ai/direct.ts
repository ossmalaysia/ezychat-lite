import type { AppContext } from '../context.js';
import { capabilitiesOf } from '../inboxes/types.js';
import type { AgentRow } from './agents.js';

/**
 * Whether the connection of an inbox has WhatsApp groups (`WaAdapter.capabilities.groups`; a linked
 * phone has, the WhatsApp Business API has not). An inbox without a live connection (removed,
 * unknown) counts as having none.
 */
export function inboxHasGroups(ctx: AppContext, inboxId: number | null): boolean {
  if (inboxId === null) return false;
  try {
    return capabilitiesOf(ctx.inboxes.connections.adapter(inboxId)).groups;
  } catch {
    return false;
  }
}

/**
 * Whether the agent answers (and may be assigned) direct chats (design
 * docs/features/ai-direct-chats/design.md). Its "Answer direct chats" switch counts only where groups
 * exist: on an inbox without groups a group-only agent would answer nothing, so it answers direct
 * chats whatever was saved (a later type change cannot silence it).
 */
export function answersDirect(ctx: AppContext, agent: AgentRow): boolean {
  return agent.answerDirect || !inboxHasGroups(ctx, agent.inboxId);
}
