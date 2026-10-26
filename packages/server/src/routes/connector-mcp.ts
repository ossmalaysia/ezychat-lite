import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

/**
 * Partner (MCP) connection routes under `/connectors/mcp/*` (design: connector-list). Filled by the
 * MCP connections module.
 */
export default async function connectorMcpRoutes(_app: FastifyInstance, _ctx: AppContext) {}
