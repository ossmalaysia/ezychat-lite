import type { FastifyInstance, FastifyRequest } from 'fastify';
import { basename } from 'node:path';
import { z } from 'zod';
import {
  AiAgentBody,
  AiCallbackBody,
  AiConnectionBody,
  AiContextPatchBody,
  AiContextTextBody,
  AiEditBody,
  AiKeyTestBody,
  type AiKeyTestResponse,
  AiMemberBody,
  AiTryBody,
  VoiceSettingBody,
  EnrichmentSettingBody,
} from '@ezychat/shared';
import { getAuth, requireAdmin } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { HttpError, errors, parse } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { AI_UPLOAD_BYTES } from '../ai/knowledge.js';
import { extractKnowledgeIsolated } from '../ai/knowledge-worker.js';
import { createAiKeyTester } from '../ai/key-test.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const AgentParams = z.object({ agentId: z.coerce.number().int().positive() });
const AgentItemParams = AgentParams.extend({ id: z.coerce.number().int().positive() });

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
  const signInLimiter = new WindowLimiter({ windowMs: 60_000, max: 5 });
  const pasteLimiter = new WindowLimiter({ windowMs: 60_000, max: 10 });
  const tryLimiter = new WindowLimiter({ windowMs: 60_000, max: 10 });
  const editLimiter = new WindowLimiter({ windowMs: 60_000, max: 10 });
  const keyTestLimiter = new WindowLimiter({ windowMs: 60_000, max: 10 });
  const keyTest = ctx.services.aiKeyTest ?? createAiKeyTester({ log: ctx.log });
  const limit = (limiter: WindowLimiter, req: FastifyRequest) => {
    const result = limiter.hit(String(req.user!.id));
    if (!result.allowed) throw errors.rateLimited(result.retryAfterSec);
  };
  app.get('/ai', async () => ai.status());
  app.get('/ai/enrichment', async () => ctx.services.enrichment!.status());
  app.put('/ai/enrichment', async (req) =>
    ctx.services.enrichment!.setEnabled(parse(EnrichmentSettingBody, req.body).enabled, actor(req)),
  );
  app.put('/ai', async (req) => ai.saveMember(parse(AiMemberBody, req.body), actor(req)));
  app.patch('/ai/connection', async (req) =>
    ai.saveConnection(parse(AiConnectionBody, req.body), actor(req)),
  );
  // Checks an OpenAI (default) or Claude key before the page saves it; the key is neither stored
  // nor logged here.
  app.post('/ai/connection/test', async (req): Promise<AiKeyTestResponse> => {
    limit(keyTestLimiter, req);
    const { apiKey, mode = 'api' } = parse(AiKeyTestBody, req.body);
    const result = await keyTest(apiKey, mode);
    recheck(req);
    return result;
  });
  /**
   * One uploaded file: the `internal` form field must come before the file (default false).
   * Returns the extracted item; the caller stores it under the right agent.
   */
  const readUpload = async (req: FastifyRequest) => {
    const file = await req.file({ limits: { fileSize: AI_UPLOAD_BYTES, files: 1 } });
    if (!file) throw errors.validation('Choose a business document');
    const field = file.fields.internal;
    const value = Array.isArray(field) ? field[0] : field;
    const internal = value?.type === 'field' && String(value.value) === 'true';
    const name = basename(file.filename.replace(/\\/g, '/')).slice(0, 255);
    if (!name) throw errors.validation('Document filename is required');
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw errors.validation('Documents can be at most 10 MB');
    const text = await extractKnowledgeIsolated(name, buffer);
    recheck(req);
    return { name, size: buffer.length, text, internal };
  };
  const agentId = (req: FastifyRequest) => parse(AgentParams, req.params).agentId;
  const agentItem = (req: FastifyRequest) => parse(AgentItemParams, req.params);
  const agentList = () => ({ agents: ai.listAgents(), maxAgents: ai.maxAgents() });

  // Old routes mean the default agent (null: the only one, else inbox 1's) and answer in the old shape.
  app.post('/ai/documents', async (req) => {
    const upload = await readUpload(req);
    ai.addDocument(null, upload.name, upload.size, upload.text, actor(req), upload.internal);
    return ai.status();
  });
  // Business context text items (file items are uploaded above and are read-only).
  app.post('/ai/documents/text', async (req) => {
    ai.addText(null, parse(AiContextTextBody, req.body), actor(req));
    return ai.status();
  });
  app.get('/ai/documents/:id', async (req) => ai.document(null, parse(IdParams, req.params).id));
  app.patch('/ai/documents/:id', async (req) => {
    ai.updateText(
      null,
      parse(IdParams, req.params).id,
      parse(AiContextPatchBody, req.body),
      actor(req),
    );
    return ai.status();
  });
  app.delete('/ai/documents/:id', async (req) => {
    ai.removeDocument(null, parse(IdParams, req.params).id, actor(req));
    return ai.status();
  });

  // Agents: each has its own name, preset, texts and items; every item route checks the agent.
  app.get('/ai/agents', async () => agentList());
  app.post('/ai/agents', async (req) => ai.createAgent(parse(AiAgentBody, req.body), actor(req)));
  app.get('/ai/agents/:agentId', async (req) => ai.agentStatus(agentId(req)));
  app.put('/ai/agents/:agentId', async (req) =>
    ai.saveAgent(agentId(req), parse(AiAgentBody, req.body), actor(req)),
  );
  app.delete('/ai/agents/:agentId', async (req) => {
    ai.deleteAgent(agentId(req), actor(req));
    return agentList();
  });
  app.post('/ai/agents/:agentId/documents', async (req) => {
    const id = agentId(req);
    // Unknown agent: refuse before reading and extracting the file.
    ai.agentStatus(id);
    const upload = await readUpload(req);
    return ai.addDocument(id, upload.name, upload.size, upload.text, actor(req), upload.internal);
  });
  app.post('/ai/agents/:agentId/documents/text', async (req) =>
    ai.addText(agentId(req), parse(AiContextTextBody, req.body), actor(req)),
  );
  app.get('/ai/agents/:agentId/documents/:id', async (req) => {
    const { agentId: owner, id } = agentItem(req);
    return ai.document(owner, id);
  });
  app.patch('/ai/agents/:agentId/documents/:id', async (req) => {
    const { agentId: owner, id } = agentItem(req);
    return ai.updateText(owner, id, parse(AiContextPatchBody, req.body), actor(req));
  });
  app.delete('/ai/agents/:agentId/documents/:id', async (req) => {
    const { agentId: owner, id } = agentItem(req);
    return ai.removeDocument(owner, id, actor(req));
  });
  app.post('/ai/agents/:agentId/try', async (req) => {
    limit(tryLimiter, req);
    const id = agentId(req);
    // The path names the agent; an `agentId` in the body never overrides it.
    const result = await ai.tryAnswer({ ...parse(AiTryBody, req.body), agentId: id });
    recheck(req);
    return result;
  });
  app.post('/ai/agents/:agentId/edit', async (req, reply) => {
    limit(editLimiter, req);
    const id = agentId(req);
    const cancel = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) cancel.abort();
    });
    const result = await ai.editText(parse(AiEditBody, req.body), cancel.signal, id);
    recheck(req);
    return result;
  });
  app.post('/ai/try', async (req) => {
    limit(tryLimiter, req);
    const result = await ai.tryAnswer(parse(AiTryBody, req.body));
    recheck(req);
    return result;
  });
  // Edit with AI: returns a suggestion for one box; the page saves it only on Save.
  app.post('/ai/edit', async (req, reply) => {
    limit(editLimiter, req);
    // The admin closed the popup (the browser dropped the request): stop the AI call.
    const cancel = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) cancel.abort();
    });
    const result = await ai.editText(parse(AiEditBody, req.body), cancel.signal);
    recheck(req);
    return result;
  });
  app.get('/ai/models', async () => ai.models());
  app.post('/ai/chatgpt/test', async (req) => {
    const result = await ai.testConnection();
    recheck(req);
    return result;
  });
  app.post('/ai/chatgpt/login', async (req) => {
    limit(signInLimiter, req);
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
  app.post('/ai/chatgpt/callback', async (req) => {
    limit(pasteLimiter, req);
    const body = parse(AiCallbackBody, req.body);
    await ai.completeSignIn(body.url);
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

  // Voice messages: transcription engine and the on-demand local Whisper model.
  const voice = () => {
    const service = ctx.services.voice;
    if (!service) throw errors.conflict('Voice transcription is unavailable');
    return service;
  };
  const voiceDownloadLimiter = new WindowLimiter({ windowMs: 60_000, max: 5 });
  app.get('/ai/voice', async () => voice().status());
  app.patch('/ai/voice', async (req) =>
    voice().setTranscription(parse(VoiceSettingBody, req.body).transcription, actor(req)),
  );
  app.post('/ai/voice/download', async (req) => {
    limit(voiceDownloadLimiter, req);
    return voice().startDownload(actor(req));
  });
  app.post('/ai/voice/cancel', async (req) => voice().cancelDownload(actor(req)));
  app.delete('/ai/voice/model', async (req) => voice().removeModel(actor(req)));
}
