// Isolated Dev Build: npx tsx e2e/enrichment-devbuild.ts --fake-wa --mock-ai --port 7490
// Without --mock-ai, normal provider sign-in and owner's agreement are required for model calls.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { FakeWaAdapter } from '@wa-team-inbox/wa';
import { ENRICHMENT_FIELDS, type EnrichmentExtraction } from '@wa-team-inbox/shared';
import { createContext, runInitializers, shutdownServices } from '../packages/server/src/main.js';
import { createLogger } from '../packages/server/src/logger.js';
import { createAiService } from '../packages/server/src/ai/service.js';
import { buildApp } from '../packages/server/src/app.js';
import { attachRealtime } from '../packages/server/src/realtime/index.js';

if (!process.argv.includes('--fake-wa')) throw new Error('--fake-wa required');
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? 7490 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const dataIndex = process.argv.indexOf('--data');
const dataDir =
  dataIndex < 0
    ? await mkdtemp(join(tmpdir(), 'ezychat-enrichment-devbuild-'))
    : resolve(process.argv[dataIndex + 1] ?? '');
if (
  dirname(dataDir) !== resolve(tmpdir()) ||
  !basename(dataDir).startsWith('ezychat-enrichment-devbuild-')
)
  throw new Error('Only the runner temporary data directory may be reused');
const logger = await createLogger({ dataDir, stdout: false });
const { version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };
const ctx = await createContext(
  {
    dataDir,
    host: '127.0.0.1',
    port,
    mode: 'dev',
    fakeWa: true,
    webDistDir: resolve('.playwright-mcp/enrichment-web'),
    version,
  },
  { wa: new FakeWaAdapter(), log: logger.log },
);
await runInitializers(ctx);
if (process.argv.includes('--mock-ai')) {
  await ctx.services.ai!.shutdown();
  ctx.services.ai = createAiService(ctx, {
    provider: {
      generate: async () => {
        throw new Error('Sales Agent calls disabled in enrichment check');
      },
      extractCustomer: async (_settings, _key, prompt, signal) => {
        signal.throwIfAborted();
        const input = JSON.parse(prompt.input) as {
          currentSituation: { currentMessages: { text: string }[] };
        };
        const fields: EnrichmentExtraction['fields'] = [];
        for (const field of ENRICHMENT_FIELDS) {
          const prefix = `My ${field} is `;
          const evidence = input.currentSituation.currentMessages
            .flatMap((m) => m.text.split('\n'))
            .findLast((line) => line.startsWith(prefix));
          if (evidence)
            fields.push({
              field,
              value: evidence.slice(prefix.length),
              evidence,
              ownership: 'self',
              statement: 'explicit',
              current: true,
              points: { ownership: 30, clarity: 25, context: 20, validation: 15, freshness: 10 },
            });
        }
        return { fields };
      },
      connection: () => ({ state: 'connected', loginUrl: null, error: null }),
      login: async () => ({ state: 'connected', loginUrl: null, error: null }),
      logout: async () => {},
      shutdown: async () => {},
    },
  });
  ctx.settings.set('ai_inbox_provider', { mode: 'chatgpt', model: '' });
  const localFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      throw new Error('External calls blocked in mock AI check');
    return localFetch(input, init);
  };
}
const app = await buildApp(ctx);
app.addHook('onSend', (_request, reply, payload, done) => {
  reply.header('x-enrichment-devbuild', process.argv.includes('--mock-ai') ? 'mock-ai' : 'real-ai');
  done(null, payload);
});
const realtime = attachRealtime(app.server, ctx);
await app.listen({ port, host: '127.0.0.1' });
await ctx.wa.connect();
process.stdout.write(
  JSON.stringify({
    url: `http://127.0.0.1:${port}`,
    dataDir,
    mockAi: process.argv.includes('--mock-ai'),
  }) + '\n',
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  realtime.close();
  await app.close();
  await shutdownServices(ctx);
  await ctx.wa.disconnect();
  ctx.db.close();
  logger.close();
  process.exit(0);
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
