import type { Logger } from 'pino';
import type { AppContext } from '../../context.js';
import type { AgentToolsInput, ExtensionToolsTurn } from '../../ai/agent/extension-tools.js';

/** True when a connected list connector gives this agent a read tool (counts as facts). */
export function mcpConnectorLookupsAvailable(_ctx: AppContext, _agentId?: number | null): boolean {
  return false;
}

/**
 * The tools of connected list connectors for one agent turn, behind the declared guards. Filled by
 * the MCP connections module.
 */
export async function mcpConnectorAgentTools(
  _ctx: AppContext,
  _log: Logger,
  _input: AgentToolsInput,
  _options: { onFailure: () => void; onCall?: (name: string) => void },
): Promise<ExtensionToolsTurn> {
  return {
    tools: {},
    failed: () => false,
    used: () => [],
    calls: () => [],
    dispose: async () => {},
  };
}
