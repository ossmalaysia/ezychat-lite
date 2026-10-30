// Dev Build check for the hand-off rules fixes against e2e/agents-devbuild.ts (mock model, fake
// WhatsApp, temp data). Usage: node e2e/devbuild-handoff-check.mjs <port>
// The mock model follows the rules it is given (see mockDecision), so this checks what the server
// sends, keeps and shows: never a model's own judgement. Prints PASS/FAIL per step.
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
/** The AI messages of a chat once there are `n` of them (or after `ms`). */
async function aiMessages(jid, userId, n, ms = 30_000) {
  const mine = async () => (await messages(jid)).filter((m) => m.sentByUserId === userId);
  await poll(async () => (await mine()).length >= n, ms);
  return mine();
}
const customer = (jid, text) =>
  api('POST', '/dev/fake-incoming', { chatJid: jid, text, senderName: 'Zhao Zheng' });
const chat = async (jid) =>
  (await api('GET', `/chats/${encodeURIComponent(jid)}`)).json?.chat ?? {};

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);
const saved = await api('PUT', '/ai', {
  displayName: 'Anchor Sprint AI',
  enabled: false,
  instructions: '',
  handoffRules:
    'Never hand over on:\n- A consultation, meeting, demo or "book a call" request: ask a discovery question.',
});
const agent = (await api('GET', '/ai')).json.agents[0];
check(
  saved.status === 200 && agent?.preset === 'sales',
  'a sales agent is saved with "never hand over" rules',
);
check(
  agent?.resolutionCheck === false,
  'a new sales agent asks no resolution question',
  agent?.resolutionCheck,
);
await api('POST', `/ai/agents/${agent.id}/documents/text`, {
  name: 'Overview',
  text: 'Anchor Sprint sells Claude Team seats and H100 GPUs from Kuala Lumpur.',
});
const on = await api('PUT', `/ai/agents/${agent.id}`, {
  displayName: 'Anchor Sprint AI',
  enabled: true,
  instructions: '',
});
check(on.status === 200 && on.json.agent.enabled, 'the agent turns on');

// BUG 1: Try it, then a live chat.
const tried = await api('POST', `/ai/agents/${agent.id}/try`, {
  question: "Hi Anchor Sprint, I'd like to book a free consultation (from your homepage).",
  knowledge: { displayName: 'Anchor Sprint AI', instructions: '' },
});
check(
  tried.json?.action === 'answer' && !/team member/i.test(tried.json?.reply ?? ''),
  'Try it: the consultation request gets a discovery answer, not needs_action',
  JSON.stringify(tried.json && { action: tried.json.action, reason: tried.json.handoffReason }),
);
const lead = '60120000001@s.whatsapp.net';
await customer(
  lead,
  "Hi Anchor Sprint, I'd like to book a free consultation (from your homepage).",
);
const [first] = await aiMessages(lead, agent.userId, 1);
check(
  first &&
    /What would you like to cover/.test(first.body) &&
    (await chat(lead)).assignedTo === agent.userId,
  'live: the consultation chat stays with the AI and gets a discovery question',
  first?.body,
);

// BUG 2: no check-in line, and a "yes" with new facts never closes the chat.
const gpu = '60120000002@s.whatsapp.net';
await customer(gpu, 'Do you sell H100 GPUs? Where are you based? CHECKIN');
const [answer] = await aiMessages(gpu, agent.userId, 1);
check(
  answer && !/Does that answer/.test(answer.body) && /H100/.test(answer.body),
  'live: the answer has no "Does that answer your question?" line',
  answer?.body,
);
await customer(gpu, 'yes we are in Malaysia RESOLVE');
await wait(12_000);
const after = await chat(gpu);
const sent = (await messages(gpu))
  .filter((m) => m.sentByUserId === agent.userId)
  .map((m) => m.body);
check(
  after.status === 'open' && !sent.some((b) => /close this chat/i.test(b)),
  'live: "yes we are in Malaysia" keeps the chat open and nothing says "close this chat"',
  `${after.status}; ${sent.length} AI messages`,
);
// The same with the switch on: the server still refuses to close on a "yes" with new facts.
const switched = await api('PUT', `/ai/agents/${agent.id}/resolution-check`, { enabled: true });
check(
  switched.status === 200 && switched.json.agent.resolutionCheck === true,
  'the switch turns on (PUT …/resolution-check)',
);
const gpu2 = '60120000003@s.whatsapp.net';
await customer(gpu2, 'Do you sell H100 GPUs? CHECKIN');
const [asked] = await aiMessages(gpu2, agent.userId, 1);
check(
  asked && /Does that answer/.test(asked.body),
  'switch on: the answer asks the resolution question',
  asked?.body,
);
await customer(gpu2, 'yes we are in Malaysia RESOLVE');
await aiMessages(gpu2, agent.userId, 2);
check(
  (await chat(gpu2)).status === 'open',
  'switch on: a "yes" with new facts still keeps the chat open',
);
await api('PUT', `/ai/agents/${agent.id}/resolution-check`, { enabled: false });

// ALSO CHECK: silent after a hand-off, and counted as waiting.
const human = '60120000004@s.whatsapp.net';
await customer(human, 'Can I talk to a person HUMAN');
await aiMessages(human, agent.userId, 1);
await customer(human, 'GPU');
await wait(15_000);
const handed = await chat(human);
const humanSent = (await messages(human)).filter((m) => m.sentByUserId === agent.userId);
check(
  humanSent.length === 1 && handed.status === 'open' && handed.assignedTo !== agent.userId,
  'after a hand-off the AI stays silent on "GPU" and the chat is the team\'s',
  `${humanSent.length} AI messages, assignedTo ${handed.assignedTo}`,
);
const report = (await api('GET', '/reports?days=7')).json;
check(
  report?.waitingAfterHandoff?.count >= 1,
  'Reports counts the chat as waiting after an AI hand-off',
  JSON.stringify(report?.waitingAfterHandoff),
);
const audit = await api('GET', '/audit?limit=50');
check(
  JSON.stringify(audit.json ?? '').includes('ai.resolution_check_update'),
  'the switch changes are audited',
);
finish();
