import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';

export default async function (app: FastifyInstance, ctx: AppContext) {
  app.get(
    '/health',
    async (): Promise<HealthResponse> => ({
      app: 'wa-team-inbox',
      version: ctx.config.version,
      mode: ctx.config.mode,
    }),
  );
}
