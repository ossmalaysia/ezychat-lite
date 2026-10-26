import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

/**
 * Connector list routes (docs/features/connector-list/design.md): `GET /connectors/list`,
 * `POST /connectors/list/refresh`, `GET /connectors/icons/:file`. Filled by the list module.
 */
export default async function connectorListRoutes(_app: FastifyInstance, _ctx: AppContext) {}
