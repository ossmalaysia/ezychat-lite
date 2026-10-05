import { createServer } from 'node:net';
import { request } from 'node:http';
import type { AiSettings } from '@wa-team-inbox/shared';
import type { AppContext } from '../src/context.js';
import { CHATGPT_TOKENS_SECRET } from '../src/ai/chatgpt-direct.js';
import type { ChatGptTokens } from '../src/ai/chatgpt-oauth.js';

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
export function jwt(payload: Record<string, unknown>) {
  return `${b64({ alg: 'none' })}.${b64(payload)}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;
}
const CLAIMS = {
  'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123' },
  'https://api.openai.com/profile': { email: 'owner@example.com' },
};
export const ACCESS = jwt({ exp: Math.floor(Date.now() / 1000) + 3600, ...CLAIMS });
/** The access token a refresh hands out (distinct from ACCESS). */
export const ACCESS_2 = jwt({ exp: Math.floor(Date.now() / 1000) + 3600, rotation: 2, ...CLAIMS });
export const ID_TOKEN = jwt({ email: 'id@example.com' });

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
export function sse(frames: string[], split = 7) {
  const bytes = new TextEncoder().encode(frames.join(''));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
      controller.close();
    },
  });
}
export const frame = (event: Record<string, unknown>) =>
  `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;
export const tokenResponse = (extra: Record<string, unknown> = {}) =>
  json({
    access_token: ACCESS,
    refresh_token: 'refresh-1',
    id_token: ID_TOKEN,
    expires_in: 3600,
    ...extra,
  });
/** A streamed plain-text answer as the Codex backend sends it. */
export const answerText = (text: string) =>
  new Response(
    sse([
      frame({ type: 'response.output_text.delta', delta: text }),
      frame({ type: 'response.completed', response: { status: 'completed' } }),
    ]),
    { headers: { 'content-type': 'text/event-stream' } },
  );
/** A streamed structured business decision. */
export const answer = (reply: string, action = 'answer') =>
  answerText(JSON.stringify({ reply, action }));

export function rawGet(port: number, path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on('error', reject)
      .end();
  });
}
export async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}
/** Stores signed-in tokens directly (encrypted, as a completed sign-in would). */
export function seedTokens(ctx: AppContext, overrides: Partial<ChatGptTokens> = {}) {
  const tokens: ChatGptTokens = {
    accessToken: ACCESS,
    refreshToken: 'refresh-1',
    idToken: ID_TOKEN,
    accountId: 'acct-123',
    email: 'owner@example.com',
    expiresAt: Date.now() + 3600_000,
    ...overrides,
  };
  ctx.settings.setSecret(CHATGPT_TOKENS_SECRET, JSON.stringify(tokens));
}
export const CHATGPT_SETTINGS: AiSettings = {
  displayName: 'AI',
  enabled: true,
  mode: 'chatgpt',
  model: 'gpt-5.5',
  instructions: '',
  notes: '',
  faqs: [],
};
