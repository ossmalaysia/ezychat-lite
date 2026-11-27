import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AskEzyRequest, type AskEzyAnswer, type AskEzyEvent } from '@ezychat/shared';
import type { AppContext } from '../../../../packages/server/src/context.js';
import { requireUser } from '../../../../packages/server/src/auth/guards.js';
import { parse } from '../../../../packages/server/src/http/errors.js';

/**
 * Proposed (app-navigation), mock only: Ask Ezy answers from a fixed script so the panel can be shown from the new
 * rail and bottom tabs without a model call. The app's real route is `POST /api/ask-ezy` (same NDJSON events).
 *
 * Proposed (ask-ezy-image), mock only: a question may carry up to 3 pictures (JPEG, PNG or WebP read from the bytes,
 * at most 5 MB each). The mock takes them as base64 in JSON; the design sends them as multipart parts. Nothing is
 * stored: the pictures live in this request only and are never logged (counts and sizes only).
 */
export const ASK_EZY_MAX_PICTURES = 3;
export const ASK_EZY_PICTURE_BYTES = 5 * 1024 * 1024;

const MockPicture = z.strictObject({
  name: z.string().max(200),
  base64: z.string().min(1),
});
const MockAskEzyRequest = z.strictObject({
  question: z.string().max(2000),
  history: z.array(z.unknown()).default([]),
  chatJid: z.string().nullable().default(null),
  pictures: z.array(MockPicture).max(10).default([]),
});

/** Mock only: picture reading on/off (the Ask Ezy row's model) and a slow answer (to show the sending state). */
const mockState = { pictures: true, slow: false };

/** The type from the first bytes, never from the file name (same rule as `ai/images.ts#sniffImageMime`). */
function sniff(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

const fail = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

export function registerAskEzy(app: FastifyInstance, ctx: AppContext): void {
  // The demo's AI connection is the mock provider (no saved key), so the app's status route would say "not connected".
  app.get('/api/mock/ask-ezy/status', { preHandler: requireUser(ctx) }, async () => ({
    connected: ctx.services.ai?.status().connection.state === 'connected',
    // Proposed (ask-ezy-image): false when the Ask Ezy row's model cannot read pictures.
    pictures: mockState.pictures,
  }));
  app.put('/api/mock/ask-ezy/mock-state', { preHandler: requireUser(ctx) }, async (req) => {
    const body = parse(
      z.object({ pictures: z.boolean().optional(), slow: z.boolean().optional() }),
      req.body,
    );
    Object.assign(mockState, body);
    return mockState;
  });
  app.post(
    '/api/mock/ask-ezy',
    // Proposed: 3 pictures of 5 MB as base64 (the design uses multipart and a 16 MB cap on this route only).
    { preHandler: requireUser(ctx), bodyLimit: 24 * 1024 * 1024 },
    async (req, reply) => {
      const raw = parse(MockAskEzyRequest, req.body);
      const pictures = raw.pictures.map((p) => ({
        name: p.name,
        bytes: Buffer.from(p.base64, 'base64'),
      }));
      if (pictures.length && !mockState.pictures)
        return fail(
          reply,
          409,
          'pictures_unavailable',
          'The AI model for Ask Ezy cannot read pictures',
        );
      if (pictures.length > ASK_EZY_MAX_PICTURES)
        return fail(reply, 400, 'too_many_pictures', 'At most 3 pictures');
      for (const p of pictures) {
        if (p.bytes.length > ASK_EZY_PICTURE_BYTES)
          return fail(reply, 413, 'picture_too_large', 'A picture is larger than 5 MB');
        if (!sniff(p.bytes)) return fail(reply, 415, 'picture_type', 'Only JPEG, PNG or WebP');
      }
      // A picture alone is a question too: the server asks the model what it shows.
      const question =
        raw.question.trim() || (pictures.length ? 'What does this picture show?' : '');
      const body = parse(AskEzyRequest, { question, history: raw.history, chatJid: raw.chatJid });
      // Logs carry counts and sizes only, never the picture or the question.
      req.log.info(
        {
          mod: 'ask_ezy',
          pictures: pictures.length,
          pictureBytes: pictures.reduce((n, p) => n + p.bytes.length, 0),
        },
        'mock ask_ezy question',
      );
      const admin = req.user?.role === 'admin';
      const answer: AskEzyAnswer = pictures.length
        ? pictureAnswer(admin, pictures.length)
        : textAnswer(admin, body.question);
      reply.raw.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
      const send = (event: AskEzyEvent) => reply.raw.write(JSON.stringify(event) + '\n');
      const wait = mockState.slow ? 60_000 : pictures.length ? 700 : 250;
      for (const step of answer.steps) {
        send({ type: 'step', ...step });
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      send({ type: 'answer', answer });
      reply.raw.end();
      return reply;
    },
  );
}

function textAnswer(admin: boolean, question: string): AskEzyAnswer {
  const steps = admin
    ? [{ key: 'get_stats' }, { key: 'list_chats', count: 12 }]
    : [{ key: 'list_chats', count: 6 }];
  return admin
    ? {
        text: `This week your team answered 41 new customers. Most write on Monday and Friday mornings. Two chats wait more than an hour for a reply.\n\n(Demo answer to: "${question.slice(0, 80)}")`,
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
        text: `Three of your chats wait for a reply. Siti Rahman asked about delivery to Ipoh 40 minutes ago.\n\n(Demo answer to: "${question.slice(0, 80)}")`,
        blocks: [],
        steps,
        followUps: ['Summarise my latest chat'],
      };
}

/** The tester's case: a screenshot of a chat where the AI handed over, "what made this trigger?". */
function pictureAnswer(admin: boolean, count: number): AskEzyAnswer {
  const steps = [
    { key: 'pictures', count },
    { key: 'list_chats', count: 1 },
    { key: 'get_messages', count: 14 },
    ...(admin ? [{ key: 'get_ai_agent_setup' }] : []),
  ];
  return {
    text: admin
      ? `${count > 1 ? 'Your pictures show' : 'Your picture shows'} the chat with Siti Rahman at 3:42 pm, where the AI agent handed the chat to your team.\n\nWhat made it hand over: Siti asked for 15 % off an order of 12 cartons. Your hand-off rules say "Hand over any discount request above 10 %", so the AI stopped and told her a team member will help. It did what the rules say.\n\nIf you want the AI to answer this itself, add your discount limits to Business context, or change the rule.`
      : `${count > 1 ? 'Your pictures show' : 'Your picture shows'} the chat with Siti Rahman at 3:42 pm, where the AI agent handed the chat to your team.\n\nWhat made it hand over: Siti asked for 15 % off an order of 12 cartons. Discounts above 10 % go to a person, so the AI told her a team member will help. Reply to her in the chat; your admin can change the rule.`,
    blocks: [],
    steps,
    followUps: admin
      ? ['Let the AI answer discounts up to 15 %', 'How often does this happen?']
      : ['Write a reply for Siti'],
  };
}
