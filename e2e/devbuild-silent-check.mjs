// Dev Build check for the team-only "did not reply" line against e2e/agents-devbuild.ts (mock model,
// fake WhatsApp, temp data). Usage: node e2e/devbuild-silent-check.mjs <port>
// SILENT makes the mock model choose no_reply; RESOLVE makes it close the chat, which an agent
// without the resolution question turns into silence. Prints PASS/FAIL per step.
import { apiClient, checker, poll, wait } from './devbuild-client.mjs';

const PORT = Number(process.argv[2] ?? 7491);
const BASE = 'http://127.0.0.1:' + PORT;
const { check, finish } = checker();
const api = apiClient(BASE);

const health = await fetch(BASE + '/api/health');
if (health.headers.get('x-agents-devbuild') !== 'mock-ai')
  throw new Error('Run this only against e2e/agents-devbuild.ts (mock model)');

const messages = async (jid) =>
  (await api('GET', `/chats/${encodeURIComponent(jid)}/messages`)).json?.messages ?? [];
const detail = async (jid) => (await api('GET', `/chats/${encodeURIComponent(jid)}`)).json ?? {};
const customer = (jid, text) =>
  api('POST', '/dev/fake-incoming', { chatJid: jid, text, senderName: 'Zamirin' });
const silentLines = async (jid) =>
  ((await detail(jid)).events ?? []).filter((e) => e.type === 'ai_tool_used' && e.payload.silent);

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);
await api('PUT', '/ai', { displayName: 'Sales Agent', enabled: false, instructions: '' });
const agent = (await api('GET', '/ai')).json.agents[0];
check(agent?.resolutionCheck === false, 'the sales agent asks no resolution question');
await api('POST', `/ai/agents/${agent.id}/documents/text`, {
  name: 'Overview',
  text: 'Anchor Sprint builds custom AI agents for companies in Malaysia.',
});
const on = await api('PUT', `/ai/agents/${agent.id}`, {
  displayName: 'Sales Agent',
  enabled: true,
  instructions: '',
});
check(on.status === 200 && on.json.agent.enabled, 'the agent turns on');

async function answered(jid, n) {
  await poll(
    async () => (await messages(jid)).filter((m) => m.sentByUserId === agent.userId).length >= n,
    30_000,
  );
  return (await messages(jid)).filter((m) => m.sentByUserId === agent.userId).length;
}

// 1. A plain no_reply: nothing sent, the AI keeps the chat, one "did not reply" line.
const quiet = '60120000011@s.whatsapp.net';
await customer(quiet, 'Can your AI agent support customer service for a telco?');
check((await answered(quiet, 1)) === 1, 'the first question gets an AI answer');
await customer(quiet, 'ok SILENT');
await poll(async () => (await silentLines(quiet)).length > 0, 30_000);
const [line] = await silentLines(quiet);
check(line?.payload.silent.kind === 'no_reply', 'a "did not reply" line appears', line?.payload);
check(line?.actorId === agent.userId, 'the line names the agent');
check((await answered(quiet, 1)) === 1, 'no message goes to the customer');
check((await detail(quiet)).chat?.assignedTo === agent.userId, 'the AI keeps the chat');

// 2. A close without the resolution question: silence, chat open, the "finished" line.
const done = '60120000012@s.whatsapp.net';
await customer(done, 'Do you build AI agents that handle customer reports?');
check((await answered(done, 1)) === 1, 'the second chat gets an AI answer');
await customer(done, 'ya RESOLVE');
await poll(async () => (await silentLines(done)).length > 0, 30_000);
const [finished] = await silentLines(done);
check(
  finished?.payload.silent.kind === 'finished',
  'the line says the AI saw the chat as finished',
);
check((await detail(done)).chat?.status === 'open', 'the chat stays open');

// 3. The next real question is answered as usual, and no second line is added.
await customer(quiet, 'What does a pilot include?');
check((await answered(quiet, 2)) === 2, 'the next question is answered');
await wait(2_000);
check((await silentLines(quiet)).length === 1, 'only one "did not reply" line in the chat');

finish();
