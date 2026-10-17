import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@ezychat/shared';
import type { AppContext } from '../context.js';

export default async function (app: FastifyInstance, ctx: AppContext) {
  app.get('/health', async (): Promise<HealthResponse> => ({
    app: 'wa-team-inbox',
    edition: ctx.edition,
    version: ctx.config.version,
    mode: ctx.config.mode,
  }));
}
