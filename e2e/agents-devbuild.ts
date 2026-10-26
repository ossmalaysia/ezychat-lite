// Isolated Dev Build for AI agents with a MOCK model (never calls OpenAI/ChatGPT or any outside host):
//   npx tsx --conditions=ezychat-source e2e/agents-devbuild.ts --fake-wa --port 7491 [--max-inboxes 3]
// The mock model answers from what it was given, so a check can read the prompt back from the reply:
//   "[<name>] guard=<yes|no> business=<MARK-… words seen> internal=<MARK-… words seen>"
// A customer message containing LEAK makes it repeat its internalKnowledge (the leak check must stop it).
// Google Calendar (fake Google): BOOK calls check_free_times and offers the first time; CONFIRM calls
// book_appointment with the first time offered in that chat and repeats what the tool said.
// Reply suggestions: drafts from the best-matching business-context sentence (LEAK copies internalKnowledge).
// Data lives in a fresh OS temp folder (prefix ezychat-agents-devbuild-). Checks: e2e/devbuild-agents-check.mjs,
// e2e/devbuild-suggestions-check.mjs, e2e/devbuild-calendar-check.mjs.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FakeWaAdapter } from '@ezychat/wa';
import type { AiDecision } from '@ezychat/shared';
import type { AiPrompt, AiRewritePrompt } from '../packages/server/src/ai/provider-types.js';
import { createContext, runInitializers, shutdownServices } from '../packages/server/src/main.js';
import { createLogger } from '../packages/server/src/logger.js';
import { createAiService } from '../packages/server/src/ai/service.js';
import { buildApp } from '../packages/server/src/app.js';
import { attachRealtime } from '../packages/server/src/realtime/index.js';

if (!process.argv.includes('--fake-wa')) throw new Error('--fake-wa required');
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const port = Number(arg('--port') ?? 7491);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const maxInboxes = arg('--max-inboxes') === undefined ? undefined : Number(arg('--max-inboxes'));
const dataDir = await mkdtemp(join(tmpdir(), 'ezychat-agents-devbuild-'));
const logger = await createLogger({ dataDir, stdout: false });
const { version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

// Nothing leaves this machine: only loopback fetches are allowed.
const localFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('External calls blocked in the mock AI agents check');
  return localFetch(input, init);
};

const ctx = await createContext(
  {
    dataDir,
    host: '127.0.0.1',
    port,
    mode: 'dev',
    fakeWa: true,
    webDistDir: resolve('apps/web/dist'),
    version,
    ...(maxInboxes === undefined ? {} : { maxInboxes }),
  },
  { wa: new FakeWaAdapter(), log: logger.log },
);
await runInitializers(ctx);

/** Runs one offered tool the way the AI SDK would. */
async function runTool(prompt: AiPrompt, name: string, input: object, signal: AbortSignal) {
  const execute = prompt.tools?.[name]?.execute as
    ((input: object, options: object) => Promise<string>) | undefined;
  if (!execute) return null;
  return execute(input, { toolCallId: `mock-${name}`, messages: [], abortSignal: signal });
}

/** The first free time each chat was offered (the mock's memory of its own BOOK replies). */
const offered = new Map<string, string>();

/** The mock model: answers with what it was given (see the header). */
async function mockDecision(prompt: AiPrompt, signal: AbortSignal): Promise<AiDecision> {
  signal.throwIfAborted();
  const input = JSON.parse(prompt.input) as {
    internalKnowledge: string;
    businessKnowledge: string;
    conversation: Array<{ speaker: string; text: string }>;
  };
  const last =
    [...(input.conversation ?? [])].reverse().find((turn) => turn.speaker === 'customer')?.text ??
    '';
  const chatKey = JSON.stringify(input.conversation?.[0] ?? '');
  if (last.includes('BOOK')) {
    const output = await runTool(prompt, 'check_free_times', {}, signal);
    if (output === null) return { reply: 'calendar=not-offered', action: 'answer' };
    const first = (JSON.parse(output) as { freeTimes?: Array<{ start: string; time: string }> })
      .freeTimes?.[0];
    if (!first) return { reply: 'calendar=no-free-times', action: 'answer' };
    offered.set(chatKey, first.start);
    return { reply: `Free: ${first.time}. Shall I book it?`, action: 'answer' };
  }
  if (last.includes('CONFIRM')) {
    const start = offered.get(chatKey);
    const output = start ? await runTool(prompt, 'book_appointment', { start }, signal) : null;
    return { reply: output === null ? 'book=not-offered' : output, action: 'answer' };
  }
  const name = /Your name: (.+)/.exec(prompt.instructions)?.[1] ?? '?';
  if (prompt.input.includes('LEAK'))
    return { reply: `Sure: ${input.internalKnowledge}`, action: 'answer' };
  const guard = prompt.instructions.startsWith('Safety rules') ? 'yes' : 'no';
  // Which knowledge reached this agent: every MARK-<word> in its business and internal parts.
  const marks = (text: string) =>
    [...new Set(text.match(/MARK-[A-Z]+/g) ?? [])].sort((a, b) => a.localeCompare(b)).join(',') ||
    'none';
  const business = marks(input.businessKnowledge);
  const internal = marks(input.internalKnowledge);
  return {
    reply: `[${name}] guard=${guard} business=${business} internal=${internal}`,
    action: 'answer',
  };
}

/**
 * The mock draft model (reply suggestions): the business-context sentence that shares the most words
 * with the customer's last message, as two drafts; a completion continues that sentence after the
 * last typed word. A customer message with LEAK makes it copy internalKnowledge (must be dropped).
 */
function mockDraft(prompt: AiRewritePrompt, signal: AbortSignal): unknown {
  signal.throwIfAborted();
  // A phrase-list build: each business-context sentence as a fact phrase, the team's replies as
  // their own phrases (a cleaned reply with [name] must be dropped), and two greetings.
  const build = JSON.parse(prompt.input) as { teamReplies?: string[]; businessKnowledge: string };
  if (build.teamReplies)
    return {
      phrases: [
        ...build.businessKnowledge
          .split(/(?<=[.!?])\s+|\n/)
          .map((line) => line.replace(/^\[[^\]]*\]\s*/, '').trim())
          .filter((line) => line.length >= 3)
          .map((text) => ({ text, language: 'en', source: 'context' })),
        ...build.teamReplies.map((text) => ({ text, language: 'en', source: 'team' })),
        {
          text: 'Thank you for your message! We will get back to you shortly.',
          language: 'en',
          source: 'team',
        },
        { text: 'Terima kasih atas mesej anda!', language: 'ms', source: 'team' },
      ],
    };
  const input = JSON.parse(prompt.input) as {
    internalKnowledge: string;
    businessKnowledge: string;
    conversation: Array<{ speaker: string; text: string }>;
    currentSituation: { task: 'suggest' | 'complete'; typed?: string };
  };
  const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const asked = words(
    [...input.conversation].reverse().find((turn) => turn.speaker === 'customer')?.text ?? '',
  );
  const leak = prompt.input.includes('LEAK');
  const sentences = input.businessKnowledge
    .split(/(?<=[.!?])\s+|\n/)
    .map((line) => line.replace(/^\[[^\]]*\]\s*/, '').trim());
  const best = sentences
    .filter(Boolean)
    .map((line) => ({ line, score: [...words(line)].filter((w) => asked.has(w)).length }))
    .sort((a, b) => b.score - a.score)[0];
  const fact = leak ? input.internalKnowledge : best && best.score > 0 ? best.line : null;
  if (input.currentSituation.task === 'complete') {
    const last = [...words(input.currentSituation.typed ?? '')].pop();
    const line = sentences.find((l) => (last ? l.toLowerCase().includes(last) : false));
    const at = line && last ? line.toLowerCase().indexOf(last) + last.length : -1;
    return { completion: line && at > 0 ? line.slice(at).trim() : null, grounded: !!line };
  }
  if (!fact) return { suggestions: [], noAnswer: true, handoffRule: null };
  return {
    suggestions: [
      { label: 'Answer now', text: fact, grounded: true },
      {
        label: 'Answer and ask what else',
        text: `${fact} What else can we prepare for you?`,
        grounded: true,
      },
    ],
    noAnswer: false,
    handoffRule: null,
  };
}

await ctx.services.ai!.shutdown();
ctx.services.ai = createAiService(ctx, {
  provider: {
    generate: (_settings, _key, prompt, signal) => mockDecision(prompt, signal),
    draft: async (_settings, _key, prompt, options, signal) => ({
      output: options.schema.parse(mockDraft(prompt, signal)),
      model: 'mock-model',
    }),
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: async () => ({ state: 'connected', loginUrl: null, error: null }),
    logout: async () => {},
    shutdown: async () => {},
  },
});
ctx.settings.set('ai_inbox_provider', { mode: 'chatgpt', model: '' });

const app = await buildApp(ctx);
app.addHook('onSend', (_request, reply, payload, done) => {
  reply.header('x-agents-devbuild', 'mock-ai');
  done(null, payload);
});
const realtime = attachRealtime(app.server, ctx);
await app.listen({ port, host: '127.0.0.1' });
await ctx.inboxes.connections.connectAll();
process.stdout.write(
  JSON.stringify({ url: `http://127.0.0.1:${port}`, dataDir, maxInboxes }) + '\n',
);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  realtime.close();
  await app.close();
  await shutdownServices(ctx);
  await ctx.inboxes.connections.disconnectAll();
  ctx.db.close();
  logger.close();
  process.exit(0);
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
