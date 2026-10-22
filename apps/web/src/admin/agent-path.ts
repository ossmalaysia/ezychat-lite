import type { AiMemberStatus } from '@ezychat/shared';

/**
 * Where "set up the AI agent" links go: the only agent's page, a new agent while there is none, or
 * Members (which lists every agent) when there are several.
 */
export function aiAgentsPath(status: Pick<AiMemberStatus, 'agents'>): string {
  if (status.agents.length > 1) return '/admin/members';
  const only = status.agents[0];
  return only ? `/admin/members/ai/${only.id}` : '/admin/members/ai/new';
}
