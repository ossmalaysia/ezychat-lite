import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import health from './health.js';
import access from './access.js';
import setup from './setup.js';
import auth from './auth.js';
import users from './users.js';
import chats from './chats.js';
import groups from './groups.js';
import messages from './messages.js';
import notes from './notes.js';
import customers from './customers.js';
import media from './media.js';
import quickReplies from './quick-replies.js';
import push from './push.js';
import tunnel from './tunnel.js';
import settings from './settings.js';
import audit from './audit.js';
import wa from './wa.js';
import dev from './dev.js';
import clientErrors from './client-errors.js';
import ai from './ai.js';
import directory from './directory.js';
import integrations from './integrations.js';
import inboxes from './inboxes.js';

export type RouteModule = (app: FastifyInstance, ctx: AppContext) => Promise<void>;

export const routeModules: RouteModule[] = [
  health,
  access,
  setup,
  auth,
  users,
  chats,
  groups,
  messages,
  notes,
  customers,
  media,
  quickReplies,
  push,
  tunnel,
  settings,
  audit,
  wa,
  dev,
  clientErrors,
  ai,
  directory,
  integrations,
  inboxes,
];

/**
 * Registers every route module under /api, each in its own encapsulated scope (hooks stay local),
 * then each extension's routes under /api/ext/<name> (so they cannot shadow a core path and
 * inherit the global Host/Origin hooks).
 */
export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(
    async (api) => {
      for (const mod of routeModules) {
        await api.register(async (scope) => mod(scope, ctx));
      }
    },
    { prefix: '/api' },
  );
  for (const ext of ctx.extensions) {
    const routes = ext.routes;
    if (!routes) continue;
    await app.register(async (scope) => routes(scope, ctx), { prefix: `/api/ext/${ext.name}` });
  }
}
