import type { FastifyInstance } from 'fastify';
import { ReportQuery, type Report } from '@ezychat/shared';
import { AI_TIMEZONE_SETTING, resolveAiTimeZone } from '../ai/prompt.js';
import { requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { parse } from '../http/errors.js';
import { computeReport } from '../reports/report.js';

/** Admin: GET /api/reports?days=7|30|90 → Admin → Reports (every inbox: admins see them all). */
export default async function reportRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireAdmin(ctx));
  const log = ctx.log.child({ mod: 'reports' });

  app.get('/reports', async (req): Promise<Report> => {
    const { days } = parse(ReportQuery, req.query ?? {});
    const started = performance.now();
    const report = computeReport(ctx.db, {
      days,
      timeZone: resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null)),
      now: Date.now(),
    });
    log.debug({ days, ms: Math.round(performance.now() - started) }, 'report counted');
    return report;
  });
}
