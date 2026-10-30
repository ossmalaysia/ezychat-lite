// Dev Build check for group-only AI agents ("Answer direct chats", docs/features/ai-direct-chats/design.md)
// against e2e/agents-devbuild.ts (mock model, fake WhatsApp, temp data). Lite runner (no --max-inboxes).
// Usage: node e2e/devbuild-direct-check.mjs <port>
// Prints PASS/FAIL per step; never calls a model or a real WhatsApp number.
import { devbuildClient } from './devbuild-client.mjs';

const OWN = '60000000000@s.whatsapp.net';
const GROUP = '120363077700001@g.us';
const client = await devbuildClient(Number(process.argv[2] ?? 7491));
const { api, check, code, wait, finish } = client;
const signInAdmin = () => client.signInAdmin();
const enc = encodeURIComponent;
const chat = async (jid) => (await api('GET', `/chats/${enc(jid)}`)).json?.chat;
/** The AI messages of a chat after waiting `ms`. */
async function aiMessages(jid, aiUserId, ms) {
  const end = Date.now() + ms;
  let found = [];
  while (Date.now() < end) {
    const res = await api('GET', `/chats/${enc(jid)}/messages`);
    found = (res.json?.messages ?? []).filter((m) => m.sentByUserId === aiUserId);
    if (found.length) return found;
    await wait(1000);
  }
  return found;
}

await signInAdmin();

await api('PUT', '/ai', {
  displayName: 'Group Helper',
  enabled: false,
  instructions: '',
  handoffRules: '',
});
await api('POST', '/ai/documents/text', { name: 'Menu', text: 'MARK-KOPI Kopi O RM2.50' });
const agent = (await api('GET', '/ai')).json.agents[0];
const on = await api('PUT', `/ai/agents/${agent.id}`, {
  displayName: 'Group Helper',
  enabled: true,
  instructions: '',
  handoffRules: '',
});
check(on.status === 200, 'the agent turns on', on.status);

const view = (await api('GET', `/ai/agents/${agent.id}/groups`)).json;
check(
  view.answerDirect === true && view.directAvailable === true,
  'Answer direct chats is on by default on a linked phone',
  JSON.stringify({ answerDirect: view.answerDirect, directAvailable: view.directAvailable }),
);

// While on: a direct chat is answered and held by the AI.
const first = '60177700001@s.whatsapp.net';
await api('POST', '/dev/fake-incoming', {
  chatJid: first,
  text: 'Hi, Kopi O price?',
  senderName: 'Dina',
});
const firstReply = await aiMessages(first, agent.userId, 30_000);
check(
  firstReply.length > 0,
  'with the switch on, the AI answers a direct chat',
  firstReply[0]?.body,
);
check((await chat(first))?.assignedTo === agent.userId, 'the AI holds that chat');
check(
  (await api('GET', `/ai/agents/${agent.id}/groups`)).json.heldDirect === 1,
  'the view counts 1 held direct chat',
);

// Group set-up: a group switched on for the AI.
await api('POST', '/dev/fake-group', {
  groupJid: GROUP,
  name: 'Kopi Lovers Club',
  generated: 2,
  members: [{ phone: '60177700009', name: 'Nurul Huda', role: 'admin' }],
});
await api('PUT', `/ai/agents/${agent.id}/groups`, { enabled: true });
await api('PUT', `/chats/${enc(GROUP)}/ai-group`, { enabled: true });

// Off: a group-only agent.
const off = await api('PUT', `/ai/agents/${agent.id}/direct`, { enabled: false });
check(
  off.status === 200 && off.json.answerDirect === false && off.json.heldDirect === 0,
  'switching direct chats off returns the held chat',
  JSON.stringify({ status: off.status, held: off.json?.heldDirect }),
);
check((await chat(first))?.assignedTo === null, 'the chat is back with the team, unassigned');

const second = '60177700002@s.whatsapp.net';
await api('POST', '/dev/fake-incoming', {
  chatJid: second,
  text: 'Are you open?',
  senderName: 'Ali',
});
const silent = await aiMessages(second, agent.userId, 15_000);
check(silent.length === 0, 'a new direct chat gets no AI answer (15 s)', silent[0]?.body);
check((await chat(second))?.assignedTo === null, 'and the AI does not take it');

const refused = await api('PATCH', `/chats/${enc(second)}`, { assignedTo: agent.userId });
check(
  refused.status === 400 && code(refused) === 'agent_no_direct_chats',
  'assigning a direct chat to the agent is refused (400 agent_no_direct_chats)',
  `${refused.status} ${code(refused)}`,
);
const directory = (await api('GET', '/users/directory')).json.users.find(
  (u) => u.id === agent.userId,
);
check(directory?.aiNoDirect === true, 'the team directory marks the agent aiNoDirect');

await api('POST', '/dev/fake-incoming', {
  chatJid: GROUP,
  text: '@60000000000 how much is Kopi O?',
  senderJid: '60177700009@s.whatsapp.net',
  senderName: 'Nurul Huda',
  mentionedJids: [OWN],
});
const groupReply = await aiMessages(GROUP, agent.userId, 30_000);
check(
  groupReply.length > 0,
  'a tag in the switched-on group is still answered',
  groupReply[0]?.body,
);

const audit = (await api('GET', '/audit?limit=50')).json;
const rows = audit?.entries ?? audit?.items ?? audit?.rows ?? [];
check(
  rows.some((r) => r.action === 'ai.direct_switch'),
  'the switch is in the audit log (ai.direct_switch)',
);

// Back on: a new direct chat is answered again.
await api('PUT', `/ai/agents/${agent.id}/direct`, { enabled: true });
const third = '60177700003@s.whatsapp.net';
await api('POST', '/dev/fake-incoming', {
  chatJid: third,
  text: 'Kopi O price?',
  senderName: 'Siti',
});
const thirdReply = await aiMessages(third, agent.userId, 30_000);
check(
  thirdReply.length > 0,
  'switched back on, a new direct chat is answered',
  thirdReply[0]?.body,
);

finish();
