import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { getConnectorList, type ConnectorListServiceImpl } from '../connectors/list/service.js';
import { errors } from '../http/errors.js';

/** Longest wait of `POST /connectors/list/refresh` (the downloads time out after 10 s each). */
export const REFRESH_WAIT_MS = 12_000;

/**
 * Connector list routes (docs/features/connector-list/design.md): `GET /connectors/list`,
 * `POST /connectors/list/refresh` (admins; Admin → Connectors calls it when it opens and on Check for
 * new connectors), `GET /connectors/icons/:file` (any signed-in user; only icons the current list
 * names, served as images that can run nothing).
 */
export default async function connectorListRoutes(app: FastifyInstance, ctx: AppContext) {
  const admin = { preHandler: requireAdmin(ctx) };
  const user = { preHandler: requireUser(ctx) };

  app.get('/connectors/list', admin, async () => getConnectorList(ctx).gallery());

  app.post('/connectors/list/refresh', admin, async () => {
    const list = getConnectorList(ctx);
    let timer: NodeJS.Timeout | undefined;
    const wait = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, REFRESH_WAIT_MS);
      timer.unref();
    });
    try {
      await Promise.race([list.refresh(), wait]);
    } finally {
      clearTimeout(timer);
    }
    return list.gallery();
  });

  app.get('/connectors/icons/:file', user, async (req, reply) => {
    const file = String((req.params as { file?: unknown }).file ?? '');
    const list = getConnectorList(ctx) as Partial<ConnectorListServiceImpl>;
    const icon = list.icon?.(file) ?? null;
    if (!icon) throw errors.notFound('Icon');
    return reply
      .header('content-type', icon.contentType)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .header('cache-control', 'private, max-age=3600')
      .send(icon.bytes);
  });
}
