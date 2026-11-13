// Dev Build check for the AI completion rate in Reports (docs/workbooks/feat__ai-completion-rate.md) against
// e2e/agents-devbuild.ts (mock model, fake WhatsApp, temp data). Usage: node e2e/devbuild-ai-completion-check.mjs <port>
// Four chats: the AI answers and a teammate only closes it (completed); the AI answers, a teammate replies, closes
// (a person replied); HUMAN makes the AI hand over, a teammate replies, closes (hand-off); the AI answers and the chat
// stays open (still open with the AI). Prints PASS/FAIL per step.
import { apiClient, checker, poll } from './devbuild-client.mjs';

const PORT = Number(process.argv[2] ?? 7491);
const BASE = 'http://127.0.0.1:' + PORT;
const { check, finish } = checker();
const api = apiClient(BASE);

const health = await fetch(BASE + '/api/health');
if (health.headers.get('x-agents-devbuild') !== 'mock-ai')
  throw new Error('Run this only against e2e/agents-devbuild.ts (mock model)');

const enc = encodeURIComponent;
const messages = async (jid) =>
  (await api('GET', `/chats/${enc(jid)}/messages`)).json?.messages ?? [];
const customer = (jid, text) =>
  api('POST', '/dev/fake-incoming', { chatJid: jid, text, senderName: 'Customer' });

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);
await api('PUT', '/ai', { displayName: 'Sales Agent', enabled: false, instructions: '' });
const agent = (await api('GET', '/ai')).json.agents[0];
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

const before = (await api('GET', '/reports?days=7')).json;
check(before?.totals?.aiClosed === 0 && before?.aiOpen === 0, 'no AI chats yet', before?.totals);

async function aiAnswered(jid) {
  await poll(
    async () =>
      (await messages(jid)).some((m) => m.sentByUserId === agent.userId && m.status !== 'pending'),
    30_000,
  );
}
async function teamReplies(jid, text) {
  const sent = await api('POST', `/chats/${enc(jid)}/messages`, {
    text,
    clientId: `check-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  });
  check(
    sent.status >= 200 && sent.status < 300,
    `a teammate replies in ${jid.slice(0, 11)}`,
    sent.status,
  );
  await poll(
    async () => (await messages(jid)).some((m) => m.body === text && m.status !== 'pending'),
    30_000,
  );
}
async function close(jid) {
  const res = await api('PATCH', `/chats/${enc(jid)}`, { status: 'resolved' });
  check(res.status === 200, `the chat ${jid.slice(0, 11)} is closed`, res.status);
}

// 1. Completed: the AI answers, a teammate only presses Close.
const done = '60120000021@s.whatsapp.net';
await customer(done, 'Do you build AI agents for clinics?');
await aiAnswered(done);
await close(done);
// 2. A person replied after the AI.
const replied = '60120000022@s.whatsapp.net';
await customer(replied, 'What does a pilot include?');
await aiAnswered(replied);
await teamReplies(replied, 'I will send you the pilot plan today.');
await close(replied);
// 3. The AI hands over, a teammate replies.
const handed = '60120000023@s.whatsapp.net';
await customer(handed, 'HUMAN please');
await aiAnswered(handed);
await teamReplies(handed, 'Hi, this is Checker from the team.');
await close(handed);
// 4. Still open with the AI.
const open = '60120000024@s.whatsapp.net';
await customer(open, 'Can your AI agent read PDFs?');
await aiAnswered(open);

// Reports are cached for a minute per period: the 30-day report has not been counted yet.
const report = (await api('GET', '/reports?days=30')).json;
check(
  report?.totals?.aiClosed === 3 &&
    report.totals.aiCompleted === 1 &&
    report.totals.aiClosedAfterHandoff === 1 &&
    report.totals.aiClosedAfterReply === 1,
  'Reports counts 3 closed AI chats: 1 completed, 1 hand-off, 1 a person replied',
  report?.totals,
);
check(report?.aiOpen === 1, 'one chat is still open with the AI', report?.aiOpen);

finish();
