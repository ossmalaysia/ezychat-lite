import type { FastifyInstance } from 'fastify';
import type { AppContext } from './context.js';
import type { AgentToolsInput, AgentToolsResult } from './ai/agent/extension-tools.js';

/** Lowercase id used for the route prefix (/api/ext/<name>) and the migration track. */
export const EXTENSION_NAME = /^[a-z][a-z0-9-]{1,31}$/;
const RESERVED = new Set(['lite', 'core']);

/**
 * A feature added by another product build (e.g. EzyChat Enterprise) without changing core code.
 * Lite itself passes no extensions.
 */
export interface ServerExtension {
  name: string;
  /** Folder of NNN_*.sql files, applied once each and tracked in extension_migrations. */
  migrationsDir?: string;
  /** Runs after every core initializer, in list order. */
  init?(ctx: AppContext): void | Promise<void>;
  /** Mounted at /api/ext/<name> after core routes; add requireUser/requireAdmin yourself. */
  routes?(api: FastifyInstance, ctx: AppContext): Promise<void>;
  /**
   * Extra read tools for one AI turn (live reply or Try it), merged with the core tools within
   * the same step limit and abort/timeout. Return null to add none. A tool that throws (e.g.
   * `ToolHandoverError`) ends the turn with a hand-over (reason `lookup_failed`). `dispose` runs
   * when the turn ends. Calls are announced on the bus as `ai:tool_call` (no input or output).
   */
  agentTools?(ctx: AppContext, input: AgentToolsInput): Promise<AgentToolsResult | null>;
}

export function validateExtensions(list: readonly ServerExtension[]): void {
  const seen = new Set<string>();
  for (const ext of list) {
    if (!EXTENSION_NAME.test(ext.name) || RESERVED.has(ext.name))
      throw new Error(`invalid extension name ${JSON.stringify(ext.name)}`);
    if (seen.has(ext.name)) throw new Error(`duplicate extension "${ext.name}"`);
    seen.add(ext.name);
  }
}

export function validateEdition(id: string): void {
  if (!EXTENSION_NAME.test(id)) throw new Error(`invalid edition ${JSON.stringify(id)}`);
}
