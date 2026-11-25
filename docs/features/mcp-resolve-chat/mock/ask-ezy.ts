import type { FastifyInstance } from 'fastify';
import { AskEzyRequest, type AskEzyAnswer, type AskEzyEvent } from '@ezychat/shared';
import type { AppContext } from '../../../../packages/server/src/context.js';
import { requireUser } from '../../../../packages/server/src/auth/guards.js';
import { parse } from '../../../../packages/server/src/http/errors.js';

/**
 * Proposed (app-navigation), mock only: Ask Ezy answers from a fixed script so the panel can be shown from the new
 * rail and bottom tabs without a model call. The app's real route is `POST /api/ask-ezy` (same NDJSON events).
 */
export function registerAskEzy(app: FastifyInstance, ctx: AppContext): void {
  // The demo's AI connection is the mock provider (no saved key), so the app's status route would say "not connected".
  app.get('/api/mock/ask-ezy/status', { preHandler: requireUser(ctx) }, async () => ({
    connected: ctx.services.ai?.status().connection.state === 'connected',
  }));
  app.post('/api/mock/ask-ezy', { preHandler: requireUser(ctx) }, async (req, reply) => {
    const body = parse(AskEzyRequest, req.body);
    const admin = req.user?.role === 'admin';
    const steps = admin
      ? [{ key: 'get_stats' }, { key: 'list_chats', count: 12 }]
      : [{ key: 'list_chats', count: 6 }];
    const answer: AskEzyAnswer = admin
      ? {
          text: `This week your team answered 41 new customers. Most write on Monday and Friday mornings. Two chats wait more than an hour for a reply.\n\n(Demo answer to: "${body.question.slice(0, 80)}")`,
          blocks: [
            {
              type: 'stats',
              items: [
                { label: 'New customers', value: '41', change: '+8 vs last week', good: true },
                { label: 'Median first reply', value: '6 min', change: '−2 min', good: true },
                { label: 'Missed', value: '2' },
              ],
            },
            {
              type: 'bars',
              title: 'Busiest days',
              rows: [
                { label: 'Monday', count: 12 },
                { label: 'Friday', count: 10 },
                { label: 'Wednesday', count: 7 },
              ],
            },
          ],
          steps,
          followUps: ['Which customers wait for a reply?', 'When do new customers write?'],
        }
      : {
          text: `Three of your chats wait for a reply. Siti Rahman asked about delivery to Ipoh 40 minutes ago.\n\n(Demo answer to: "${body.question.slice(0, 80)}")`,
          blocks: [],
          steps,
          followUps: ['Summarise my latest chat'],
        };
    reply.raw.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
    const send = (event: AskEzyEvent) => reply.raw.write(JSON.stringify(event) + '\n');
    for (const step of steps) {
      send({ type: 'step', ...step });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    send({ type: 'answer', answer });
    reply.raw.end();
    return reply;
  });
}
