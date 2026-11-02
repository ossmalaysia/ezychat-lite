import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SheetsAgentSettings, SpreadsheetLookupBody } from '@ezychat/shared';
import { requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { getGoogleSheets } from '../connectors/google-sheets/service.js';
import { isHostRequest } from '../http/access.js';
import { clientIp } from '../http/client-ip.js';
import { errors, parse } from '../http/errors.js';
import { escapeHtml, sendPage } from './connectors.js';

const AgentParams = z.object({ agentId: z.coerce.number().int().positive() });
const RequestParams = z.object({ requestId: z.string().regex(/^[a-f0-9]{24}$/) });
const CallbackQuery = z.object({
  state: z.string().max(200).optional(),
  code: z.string().max(2048).optional(),
  error: z.string().max(200).optional(),
});
const FakeSheetsBody = z.object({ state: z.enum(['ok', 'expired', 'unavailable']) });

export const SHEETS_CALLBACK_PATH = '/api/connectors/google-sheets/callback';

/** This server's own callback address, on the port it really listens on. */
function redirectUri(req: FastifyRequest, ctx: AppContext): string {
  const address = req.server.server.address();
  const port = address && typeof address === 'object' ? address.port : ctx.config.port;
  return `http://127.0.0.1:${port}${SHEETS_CALLBACK_PATH}`;
}

/**
 * Admin → Connectors → Google Sheets: sign-in, the spreadsheet behind a pasted link, per-agent
 * settings and the activity list (admins), and Google's redirect back (this computer only, no
 * session).
 */
export default async function connectorGoogleSheetsRoutes(app: FastifyInstance, ctx: AppContext) {
  const sheets = getGoogleSheets(ctx);
  const admin = { preHandler: requireAdmin(ctx) };
  const actor = (req: FastifyRequest) => ({ userId: req.user!.id, ip: clientIp(req) });

  app.get('/connectors/google-sheets', admin, async () => sheets.status());

  app.post('/connectors/google-sheets/connect', admin, async (req) =>
    sheets.startConnect(redirectUri(req, ctx), actor(req)),
  );

  app.get('/connectors/google-sheets/connect/:requestId', admin, async (req) => {
    const { requestId } = parse(RequestParams, req.params);
    const progress = sheets.progress(requestId);
    if (!progress) throw errors.notFound('Sign-in request');
    return progress;
  });

  // Google sends the browser here. Only this computer (the redirect address is 127.0.0.1): never
  // the LAN or the tunnel. The one-time state and the PKCE verifier guard the rest.
  app.get('/connectors/google-sheets/callback', async (req, reply) => {
    if (!isHostRequest(req))
      return sendPage(
        reply,
        403,
        'Not allowed',
        '<p>Finish the Google sign-in on the computer that runs EzyChat.</p>',
      );
    const query = CallbackQuery.safeParse(req.query ?? {});
    const page = await sheets.callback(query.success ? query.data : {});
    return sendPage(reply, page.status, page.title, `<p>${escapeHtml(page.message)}</p>`);
  });

  app.post('/connectors/google-sheets/disconnect', admin, async (req) => {
    await sheets.disconnect(actor(req));
    return sheets.status();
  });

  app.post('/connectors/google-sheets/spreadsheet', admin, async (req) => {
    const { link } = parse(SpreadsheetLookupBody, req.body ?? {});
    return sheets.spreadsheetInfo(link);
  });

  app.get('/connectors/google-sheets/agents/:agentId', admin, async (req) => {
    const { agentId } = parse(AgentParams, req.params);
    return sheets.getSettings(agentId);
  });

  app.put('/connectors/google-sheets/agents/:agentId', admin, async (req) => {
    const { agentId } = parse(AgentParams, req.params);
    // Unknown agent first (404), then the body (400).
    sheets.getSettings(agentId);
    const body = parse(SheetsAgentSettings, req.body ?? {});
    return sheets.putSettings(agentId, body, actor(req));
  });

  app.get('/connectors/google-sheets/activity', admin, async () => ({
    activity: sheets.activity(),
  }));

  // Fake Google (--fake-wa only): the consent page and a switch for the connector's states.
  const fake = sheets.fake;
  if (!fake) return;

  app.get('/dev/fake-google-sheets/consent', async (req, reply) => {
    const state = String((req.query as { state?: unknown } | null)?.state ?? '');
    const allow = sheets.fakeConsent(state, true);
    const cancel = sheets.fakeConsent(state, false);
    if (!allow || !cancel)
      return sendPage(reply, 400, 'Sign-in link expired', '<p>Start the sign-in again.</p>');
    return sendPage(
      reply,
      200,
      'Fake Google sign-in',
      `<p>EzyChat (test) wants to see, edit, create and delete your Google Sheets spreadsheets.</p><p><a id="allow" href="${escapeHtml(allow)}">Allow</a><a id="cancel" href="${escapeHtml(cancel)}">Cancel</a></p>`,
    );
  });

  app.post('/dev/fake-google-sheets', admin, async (req) => {
    fake.mode = parse(FakeSheetsBody, req.body ?? {}).state;
    return sheets.status();
  });

  app.get('/dev/fake-google-sheets', admin, async () => ({
    mode: fake.mode,
    sheets: [...fake.sheets].map(([id, sheet]) => ({
      id,
      name: sheet.name,
      tabs: Object.fromEntries(sheet.tabs),
    })),
  }));
}
