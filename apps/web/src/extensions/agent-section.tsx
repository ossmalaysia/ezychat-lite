import { createContext, useContext, type ReactNode } from 'react';
import type { AiAgentPreset } from '@ezychat/shared';

/** The AI agent whose page an extension section (`agentSections`) is rendered on. */
export interface AgentSectionInfo {
  agentId: number;
  displayName: string;
  preset: AiAgentPreset;
}

const AgentSectionContext = createContext<AgentSectionInfo | null>(null);

/** Wraps the extension sections of one agent page (core use only). */
export function AgentSectionProvider({
  value,
  children,
}: {
  value: AgentSectionInfo;
  children: ReactNode;
}) {
  return <AgentSectionContext.Provider value={value}>{children}</AgentSectionContext.Provider>;
}

/**
 * Inside an `agentSections` element: the agent whose page shows it (id, saved name and preset).
 * Null anywhere else.
 */
export function useAgentSection(): AgentSectionInfo | null {
  return useContext(AgentSectionContext);
}
