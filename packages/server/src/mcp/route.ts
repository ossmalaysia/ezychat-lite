import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { getApiTokens, parseBearer, type ApiPrincipal } from '../api-tokens/index.js';
import { audit } from '../db/audit.js';
import { clientIp, isLocalOrTunnel } from '../http/client-ip.js';
import { rateLimitKey } from '../http/rate-limit-key.js';
import { HttpError, errors } from '../http/errors.js';
import { originHost } from '../http/origin.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { ErrorCode, MCP_UPLOAD_MAX_BYTES } from '@ezychat/shared';
import { createInboxReadPort } from './inbox.js';
import { createAiSetupPort } from './ai-setup.js';
import { createInboxSendPort } from './send.js';
import { createMessageFilePort } from './file.js';
import { createMcpServer } from './server.js';
import { resourceMetadataUrl } from './oauth-routes.js';
import { MCP_PATH, MCP_UPLOADS_PATH, isMcpEnabled } from './settings.js';
import { mcpUploadStore } from './uploads.js';
import { handleMcpRequest } from './transport.js';
import { clearMcpNotice } from '../lite-import/notice.js';

/**
 * Largest /mcp request body: a 5 MB file as base64 plus the JSON-RPC envelope. Larger files go through
 * POST /mcp/uploads (streamed to disk) or a link.
 */
export const MCP_BODY_LIMIT = 8 * 1024 * 1024;

// resource_metadata tells an MCP client where to find the sign-in (RFC 9728, MCP authorization).
const unauthorized = (req: FastifyRequest) =>
  new HttpError(401, ErrorCode.UNAUTHORIZED, 'A valid access token is required', {
    'www-authenticate': `Bearer realm="ezychat", error="invalid_token", resource_metadata="${resourceMetadataUrl(req)}"`,
  });

/**
 * POST /mcp: MCP (Streamable HTTP, stateless JSON) for the owner's AI assistant: reads, AI setup and,
 * only for a token with scope `inbox:send`, text replies into existing chats. Outside /api,
 * so the cookie CSRF hook does not apply; it accepts only a personal access token, never a cookie.
 * Order: off → 404 (invisible), LAN peer → 403, Origin check, IP limit, token, token limit.
 */
export async function registerMcp(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(async (scope) => {
    const tokens = getApiTokens(ctx);
    const inbox = createInboxReadPort(ctx);
    const aiSetup = createAiSetupPort(ctx);
    // One per server: uploads waiting to be sent, and their per-token limits.
    const uploads = mcpUploadStore(ctx);
    // One per server: its per-token send limits must outlive each stateless request.
    const send = createInboxSendPort(ctx, { uploads });
    // Also one per server, for its per-token read limit.
    const files = createMessageFilePort(ctx);
    const log = ctx.log.child({ mod: 'mcp' });
    const ipLimiter = new WindowLimiter({ windowMs: 60_000, max: 120 });
    const failureLimiter = new WindowLimiter({ windowMs: 60_000, max: 10 });
    const tokenLimiter = new WindowLimiter({ windowMs: 60_000, max: 60 });
    // One audit row per IP and reason per minute: an unauthenticated caller cannot flood the log.
    const auditLimiter = new WindowLimiter({ windowMs: 60_000, max: 1 });

    const limit = (limiter: WindowLimiter, key: string) => {
      const r = limiter.hit(key);
      if (!r.allowed) throw errors.rateLimited(r.retryAfterSec);
    };

    const authenticate = (req: FastifyRequest): ApiPrincipal => {
      if (!isMcpEnabled(ctx)) throw errors.notFound(`Route ${req.method} ${MCP_PATH}`);
      if (!isLocalOrTunnel(req)) {
        throw errors.forbidden(
          'AI assistant access works only on this computer or through the tunnel',
        );
      }
      // MCP clients send no Origin; a browser page must be same-origin (DNS-rebinding defence).
      const origin = req.headers.origin;
      if (origin !== undefined && originHost(origin) !== (req.headers.host ?? '').toLowerCase()) {
        throw errors.badOrigin();
      }
      const ip = clientIp(req);
      // Limits count an IPv6 client by its /64 network; the audit row keeps the full address.
      const ipKey = rateLimitKey(ip);
      limit(ipLimiter, ipKey);
      const result = tokens.resolve(parseBearer(req.headers.authorization) ?? '');
      if (!result.ok) {
        limit(failureLimiter, ipKey);
        if (auditLimiter.hit(`${ipKey}|${result.reason}`).allowed) {
          audit(ctx.db, {
            userId: null,
            action: 'api_token.auth_failed',
            ip,
            meta: {
              reason: result.reason,
              ...(result.tokenId ? { tokenId: result.tokenId } : {}),
            },
          });
        }
        log.warn({ reason: result.reason, tokenId: result.tokenId }, 'mcp auth failed');
        throw unauthorized(req);
      }
      limit(tokenLimiter, `token:${result.principal.tokenId}`);
      return result.principal;
    };

    // onRequest runs before body parsing: a disabled endpoint, a LAN peer or a bad token never
    // reaches the parser, so they get 404/403/401 (not 400/413) and always pass the IP limiter.
    const principals = new WeakMap<FastifyRequest, ApiPrincipal>();
    scope.addHook('onRequest', async (req) => {
      principals.set(req, authenticate(req));
    });

    // The send tools take up to 5 MB as base64 (about 6.7 MB of JSON). The token is checked
    // in onRequest, before the body is read, so only a valid token can send a large body.
    scope.post(MCP_PATH, { bodyLimit: MCP_BODY_LIMIT }, async (req, reply) => {
      const principal = principals.get(req)!;
      // An AI assistant reached the new address after a Lite import: its "connect again" flag is done.
      if (clearMcpNotice(ctx.settings))
        log.info({ tokenId: principal.tokenId }, 'lite import mcp flag cleared');
      const server = createMcpServer({
        inbox,
        aiSetup,
        send,
        files,
        principal,
        log,
        stillValid: () => tokens.stillValid(principal.tokenId),
        version: ctx.config.version,
        edition: ctx.edition,
      });
      const res = await handleMcpRequest(req, server);
      return reply
        .status(res.status)
        .headers(res.headers)
        .header('cache-control', 'no-store')
        .send(res.body);
    });

    // POST /mcp/uploads: a file for send_image / send_file / send_video (design
    // docs/features/mcp-file-upload/design.md). Same reach and token check as /mcp (onRequest above,
    // before any byte of the body is read), then only a token that may send. The body is a raw file
    // (any Content-Type, name in X-File-Name) or multipart/form-data with one `file` part; it is
    // streamed to a private file, never parsed or held in memory.
    await scope.register(async (up) => {
      up.removeContentTypeParser(['application/json', 'text/plain']);
      up.addContentTypeParser('*', (_req, payload, done) => done(null, payload));
      // A refused upload may not have been read: close the connection rather than drain the rest.
      up.addHook('onSend', async (_req, reply) => {
        if (reply.statusCode >= 400) reply.header('connection', 'close');
      });
      up.post(
        MCP_UPLOADS_PATH,
        {
          onRequest: async (req) => {
            const principal = principals.get(req)!;
            if (!principal.scopes.has('inbox:send'))
              throw errors.forbidden('This access token cannot send messages, so it cannot upload');
            // A declared body that can never fit is refused before it is read (multipart adds a
            // little framing around the file).
            const declared = Number(req.headers['content-length']);
            if (Number.isFinite(declared) && declared > MCP_UPLOAD_MAX_BYTES + 64 * 1024)
              throw new HttpError(
                413,
                'upload_too_large',
                `The file is larger than ${MCP_UPLOAD_MAX_BYTES / 1024 / 1024} MB.`,
              );
          },
        },
        async (req, reply) => {
          const principal = principals.get(req)!;
          let body: Readable;
          let name: string | undefined;
          let declaredLength: number | undefined;
          if (req.isMultipart()) {
            const part = await req.file({
              limits: { fileSize: MCP_UPLOAD_MAX_BYTES + 1, files: 1, fields: 4, parts: 5 },
            });
            if (!part || part.fieldname !== 'file') {
              part?.file.resume();
              throw errors.validation('Send the file as the multipart part named "file".');
            }
            body = part.file;
            name = part.filename;
          } else {
            if (!req.body || typeof (req.body as Readable).pipe !== 'function')
              throw errors.validation('The file is empty.');
            body = req.body as Readable;
            const header = req.headers['x-file-name'];
            name = Array.isArray(header) ? header[0] : header;
            const length = Number(req.headers['content-length']);
            declaredLength = Number.isFinite(length) ? length : undefined;
          }
          const uploaded = await uploads.receive(principal.tokenId, body, { name, declaredLength });
          return reply.status(201).header('cache-control', 'no-store').send(uploaded);
        },
      );
    });

    // Stateless JSON mode has no SSE stream or session to open or delete.
    scope.route({
      method: ['GET', 'DELETE', 'PUT', 'PATCH'],
      url: MCP_PATH,
      handler: async (_req, reply) => {
        return reply
          .status(405)
          .header('allow', 'POST')
          .type('application/json')
          .send({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed' },
            id: null,
          });
      },
    });
  });
}
