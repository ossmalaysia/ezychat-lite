import type { Logger } from 'pino';
import type { AppContext } from '../../context.js';
import {
  BOOK_APPOINTMENT,
  calendarAgentTools,
  calendarLookupsAvailable,
} from '../../connectors/google-calendar/tools.js';
import {
  mcpConnectorAgentTools,
  mcpConnectorLookupsAvailable,
} from '../../connectors/mcp/tools.js';
import {
  ADD_CRM_LEAD,
  zohoAgentTools,
  zohoLookupsAvailable,
} from '../../connectors/zoho-crm/tools.js';
import {
  extensionAgentTools,
  extensionLookupsAvailable,
  type AgentKind,
  type AgentToolsInput,
  type ExtensionToolsTurn,
} from './extension-tools.js';

/**
 * Every look-up source an agent may use besides its Business context: core connectors (Google
 * Calendar with Check free times on, Zoho CRM with Find the customer on) and extension look-ups
 * (`hasAgentLookups`).
 */
export function agentLookupsAvailable(
  ctx: AppContext,
  agent: AgentKind,
  agentId?: number | null,
): boolean {
  return (
    calendarLookupsAvailable(ctx, agentId) ||
    zohoLookupsAvailable(ctx, agentId) ||
    mcpConnectorLookupsAvailable(ctx, agentId) ||
    extensionLookupsAvailable(ctx, agent, agentId ?? undefined)
  );
}

/**
 * The tools of one AI agent turn besides the core read tools: core connector tools first, then
 * every extension's. Failures of either end the turn (the caller hands over with `lookup_failed`).
 * `lookupsOnly` (a WhatsApp group answer): no tool that changes data — no calendar booking and no
 * connector write tool. Extension tools are look-ups by contract (`hasAgentLookups`).
 */
export async function agentTurnTools(
  ctx: AppContext,
  log: Logger,
  input: AgentToolsInput,
  options: { onFailure: () => void; onCall?: (name: string) => void; lookupsOnly?: boolean },
): Promise<ExtensionToolsTurn> {
  const calendar = calendarAgentTools(ctx, log, input, options);
  if (options.lookupsOnly) delete calendar.tools[BOOK_APPOINTMENT];
  const zoho = zohoAgentTools(ctx, log, input, options);
  if (options.lookupsOnly) delete zoho.tools[ADD_CRM_LEAD];
  const listed = await mcpConnectorAgentTools(ctx, log, input, options);
  const extension = await extensionAgentTools(ctx, log, input, options);
  return {
    tools: { ...extension.tools, ...listed.tools, ...zoho.tools, ...calendar.tools },
    failed: () => calendar.failed() || listed.failed() || extension.failed(),
    used: () => [...calendar.used(), ...zoho.used(), ...listed.used(), ...extension.used()],
    calls: () => [...calendar.calls(), ...zoho.calls(), ...listed.calls(), ...extension.calls()],
    dispose: async () => {
      await calendar.dispose();
      await zoho.dispose();
      await listed.dispose();
      await extension.dispose();
    },
  };
}
