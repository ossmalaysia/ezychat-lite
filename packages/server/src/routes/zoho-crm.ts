import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZohoCrmAgentSettings, ZohoCrmConnectBody } from '@ezychat/shared';
import { requireAdmin, requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { getZohoCrm } from '../connectors/zoho-crm/service.js';
import { isHostRequest } from '../http/access.js';
import { clientIp } from '../http/client-ip.js';
import { errors, parse } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { chatJidParam } from './chats.js';
import { escapeHtml, sendPage } from './connectors.js';

const AgentParams = z.object({ agentId: z.coerce.number().int().positive() });
const RequestParams = z.object({ requestId: z.string().regex(/^[a-f0-9]{24}$/) });
const CallbackQuery = z.object({
  state: z.string().max(200).optional(),
  code: z.string().max(2048).optional(),
  error: z.string().max(200).optional(),
  'accounts-server': z.string().max(200).optional(),
  location: z.string().max(20).optional(),
});
const FakeZohoBody = z.object({ state: z.enum(['ok', 'expired', 'unavailable']) });

export const ZOHO_CALLBACK_PATH = '/api/connectors/zoho-crm/callback';

/** This server's own callback address, on the port it really listens on. */
function redirectUri(req: FastifyRequest, ctx: AppContext): string {
  const address = req.server.server.address();
  const port = address && typeof address === 'object' ? address.port : ctx.config.port;
  return `http://127.0.0.1:${port}${ZOHO_CALLBACK_PATH}`;
}

/**
 * Zoho CRM connector (design docs/features/zoho-crm/design.md): sign-in, per-agent settings and the
 * activity list (admins); Zoho's redirect back (this computer only, no session); the chat's record
 * and "Add as a lead" for anyone who may open the chat (404 outside their inboxes).
 */
export default async function zohoCrmRoutes(app: FastifyInstance, ctx: AppContext) {
  const zoho = getZohoCrm(ctx);
  const admin = { preHandler: requireAdmin(ctx) };
  const user = { preHandler: requireUser(ctx) };
  const actor = (req: FastifyRequest) => ({ userId: req.user!.id, ip: clientIp(req) });
  // Each record read can cost Zoho API credits; adding is rarer still.
  const readLimiter = new WindowLimiter({ windowMs: 60_000, max: 60 });
  const addLimiter = new WindowLimiter({ windowMs: 60_000, max: 10 });
  const limit = (limiter: WindowLimiter, req: FastifyRequest) => {
    const result = limiter.hit(String(req.user!.id));
    if (!result.allowed) throw errors.rateLimited(result.retryAfterSec);
  };

  app.get('/connectors/zoho-crm', admin, async () => zoho.status());

  app.post('/connectors/zoho-crm/connect', admin, async (req) => {
    const { region } = parse(ZohoCrmConnectBody, req.body ?? {});
    return zoho.startConnect(region, redirectUri(req, ctx), actor(req));
  });

  app.get('/connectors/zoho-crm/connect/:requestId', admin, async (req) => {
    const { requestId } = parse(RequestParams, req.params);
    const progress = zoho.progress(requestId);
    if (!progress) throw errors.notFound('Sign-in request');
    return progress;
  });

  // Zoho sends the browser here: only this computer (the redirect address is 127.0.0.1), never the
  // LAN or the tunnel. The one-time state guards the rest.
  app.get('/connectors/zoho-crm/callback', async (req, reply) => {
    if (!isHostRequest(req))
      return sendPage(
        reply,
        403,
        'Not allowed',
        '<p>Finish the Zoho sign-in on the computer that runs EzyChat.</p>',
      );
    const query = CallbackQuery.safeParse(req.query ?? {});
    const page = await zoho.callback(query.success ? query.data : {});
    return sendPage(reply, page.status, page.title, `<p>${escapeHtml(page.message)}</p>`);
  });

  app.post('/connectors/zoho-crm/disconnect', admin, async (req) => {
    await zoho.disconnect(actor(req));
    return zoho.status();
  });

  app.get('/connectors/zoho-crm/agents/:agentId', admin, async (req) => {
    const { agentId } = parse(AgentParams, req.params);
    return zoho.getSettings(agentId);
  });

  app.put('/connectors/zoho-crm/agents/:agentId', admin, async (req) => {
    const { agentId } = parse(AgentParams, req.params);
    zoho.getSettings(agentId);
    const body = parse(ZohoCrmAgentSettings, req.body ?? {});
    return zoho.putSettings(agentId, body, actor(req));
  });

  app.get('/connectors/zoho-crm/activity', admin, async () => ({ activity: zoho.activity() }));

  app.get('/chats/:jid/zoho-crm', user, async (req) => {
    const jid = chatJidParam(ctx, req);
    limit(readLimiter, req);
    return zoho.chatRecord(jid);
  });

  app.post('/chats/:jid/zoho-crm/lead', user, async (req) => {
    const jid = chatJidParam(ctx, req);
    limit(addLimiter, req);
    return zoho.addLeadByTeam(jid, actor(req));
  });

  // Fake Zoho (--fake-wa only): the consent page and a switch for the connector's states.
  const fake = zoho.fake;
  if (!fake) return;

  app.get('/dev/fake-zoho/consent', async (req, reply) => {
    const state = String((req.query as { state?: unknown } | null)?.state ?? '');
    const accept = zoho.fakeConsent(state, true);
    const cancel = zoho.fakeConsent(state, false);
    if (!accept || !cancel)
      return sendPage(reply, 400, 'Sign-in link expired', '<p>Start the sign-in again.</p>');
    return sendPage(
      reply,
      200,
      'Fake Zoho sign-in',
      `<p>EzyChat (test) wants to read contacts and leads, add leads, and see your organisation and users.</p><p><a id="accept" href="${escapeHtml(accept)}">Accept</a><a id="cancel" href="${escapeHtml(cancel)}">Cancel</a></p>`,
    );
  });

  app.post('/dev/fake-zoho', admin, async (req) => {
    fake.mode = parse(FakeZohoBody, req.body ?? {}).state;
    return zoho.refreshStatus();
  });

  app.get('/dev/fake-zoho', admin, async () => ({
    mode: fake.mode,
    leads: fake.records.filter((r) => r.module === 'Leads').length,
  }));
}
