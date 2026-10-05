import type { FastifyInstance, FastifyRequest } from 'fastify';
import { basename } from 'node:path';
import { z } from 'zod';
import { AiConnectionBody, AiMemberBody } from '@wa-team-inbox/shared';
import { getAuth, requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { HttpError, errors, parse } from '../http/errors.js';
import { AI_UPLOAD_BYTES } from '../ai/knowledge.js';
import { extractKnowledgeIsolated } from '../ai/knowledge-worker.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });

export default async function aiRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireAdmin(ctx));
  const ai = ctx.services.ai!;
  const actor = (req: FastifyRequest) => ({ userId: req.user!.id, ip: clientIp(req) });
  const recheck = (req: FastifyRequest) => {
    const current = getAuth(ctx).resolveSession(req.sessionToken!);
    if (!current) throw errors.unauthorized();
    if (current.role !== 'admin' || current.mustChangePassword)
      throw errors.forbidden('Admin only');
  };
  app.get('/ai', async () => ai.status());
  app.put('/ai', async (req) => ai.saveMember(parse(AiMemberBody, req.body), actor(req)));
  app.patch('/ai/connection', async (req) =>
    ai.saveConnection(parse(AiConnectionBody, req.body), actor(req)),
  );
  app.post('/ai/documents', async (req) => {
    const file = await req.file({ limits: { fileSize: AI_UPLOAD_BYTES, files: 1 } });
    if (!file) throw errors.validation('Choose a business document');
    const name = basename(file.filename.replace(/\\/g, '/')).slice(0, 255);
    if (!name) throw errors.validation('Document filename is required');
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw errors.validation('Documents can be at most 10 MB');
    const text = await extractKnowledgeIsolated(name, buffer);
    recheck(req);
    return ai.addDocument(name, buffer.length, text, actor(req));
  });
  app.delete('/ai/documents/:id', async (req) =>
    ai.removeDocument(parse(IdParams, req.params).id, actor(req)),
  );
  app.get('/ai/models', async () => ai.models());
  app.post('/ai/chatgpt/test', async (req) => {
    const result = await ai.testConnection();
    recheck(req);
    return result;
  });
  app.post('/ai/chatgpt/login', async (req) => {
    try {
      await ai.login();
    } catch (error) {
      // Provider messages are fixed, credential-free strings (e.g. callback port in use).
      if (error instanceof HttpError) throw error;
      throw errors.conflict(error instanceof Error ? error.message : 'ChatGPT sign-in failed');
    }
    try {
      recheck(req);
    } catch (error) {
      await ai.logout();
      throw error;
    }
    return ai.status();
  });
  app.post('/ai/chatgpt/logout', async (req) => {
    await ai.logout();
    recheck(req);
    return ai.status();
  });
}
