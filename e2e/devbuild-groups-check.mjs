// Dev Build check for AI agents in WhatsApp groups (docs/features/ai-groups/design.md) against
// e2e/agents-devbuild.ts (mock model, fake WhatsApp, temp data). Start the runner without
// --max-inboxes, then:   node e2e/devbuild-groups-check.mjs <port>
// Prints PASS/FAIL per step; never calls a model or a real WhatsApp number.
const PORT = Number(process.argv[2] ?? 7491);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)
  throw new Error('The port must be an integer between 1024 and 65535.');
const BASE = `http://127.0.0.1:${PORT}`;
let failed = 0;
const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ');
const check = (ok, step, detail = '') => {
  if (!ok) failed++;
  const extra = detail ? '  (' + oneLine(detail).slice(0, 240) + ')' : '';
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + step + extra);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await fetch(BASE + '/api/health');
if (health.headers.get('x-agents-devbuild') !== 'mock-ai')
  throw new Error('Run this only against e2e/agents-devbuild.ts (mock model)');

let cookie = '';
/** One API path of the local Dev Build: plain segments only (ids from the server are data). */
function apiUrl(path) {
  if (
    !/^(\/[\w%@.:?=&-]+)+$/.test(path) ||
    path.split('/').some((part) => part === '..' || part === '.')
  )
    throw new Error(`Unexpected API path: ${path}`);
  const url = new URL(`/api${path}`, BASE);
  if (url.origin !== BASE) throw new Error('Refusing a link outside the local Dev Build');
  return url.href;
}
async function api(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { html: text };
  }
  return { status: res.status, json };
}
const enc = encodeURIComponent;

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);
await api('PUT', '/ai', {
  displayName: 'Aina',
  enabled: false,
  instructions: '',
  handoffRules: '',
});
await api('POST', '/ai/documents/text', {
  name: 'Shop',
  text: 'We open daily 8am to 10pm. The kitchen closes at 9.30pm.',
});
const on = await api('PUT', '/ai', {
  displayName: 'Aina',
  enabled: true,
  instructions: '',
  handoffRules: '',
});
const agent = (await api('GET', '/ai')).json.agents[0];
check(on.status === 200 && agent?.enabled, 'the AI agent is on', on.status);

// A group with members; the agent and the group switched on.
const GROUP = '120363099990001@g.us';
const NURUL = '60126677889@s.whatsapp.net';
const ARJUN = '60190000101@s.whatsapp.net';
await api('POST', '/dev/fake-group', {
  groupJid: GROUP,
  name: 'Kopi Lovers Club',
  generated: 0,
  members: [
    { phone: '60126677889', name: 'Nurul Huda', role: 'admin' },
    { phone: '60190000101', name: 'Arjun Pillai' },
  ],
});
const me = (await api('GET', '/wa/status')).json?.me?.jid ?? '60000000000@s.whatsapp.net';
let n = 0;
/** A member's message; returns its stored id. */
async function say(senderJid, senderName, text, extra = {}) {
  const r = await api('POST', '/dev/fake-incoming', {
    chatJid: GROUP,
    senderJid,
    senderName,
    text,
    ...extra,
  });
  n++;
  return r.json?.messageId ?? r.json?.id ?? null;
}
const messages = async () =>
  (await api('GET', `/chats/${enc(GROUP)}/messages`)).json?.messages ?? [];
const aiMessages = async () => (await messages()).filter((m) => m.sentByUserId === agent.userId);
const events = async () =>
  ((await api('GET', `/chats/${enc(GROUP)}`)).json?.events ?? []).filter(
    (e) => e.type === 'ai_tool_used' && e.payload?.group,
  );
/** Waits until the AI sent more than `count` messages in the group, or `ms` passed. */
async function aiAfter(count, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const mine = await aiMessages();
    if (mine.length > count && mine.at(-1).status !== 'pending') return mine.at(-1);
    await wait(400);
  }
  return null;
}

await say(NURUL, 'Nurul Huda', 'Morning all!');
const groupsOn = await api('PUT', `/ai/agents/${agent.id}/groups`, { enabled: true });
const groupOn = await api('PUT', `/chats/${enc(GROUP)}/ai-group`, { enabled: true });
check(
  groupsOn.status === 200 && groupOn.status === 200 && groupOn.json?.enabled === true,
  'Answer in groups and the group switched on',
  JSON.stringify(groupOn.json),
);
check(
  groupOn.json?.agentEnabled === true && groupOn.json?.agentAnswersGroups === true,
  'Group info state: agent on and answering groups',
);

// 1. A tag gets an answer that quotes the member; the chat keeps no assignee.
const tagId = await say(NURUL, 'Nurul Huda', '@Kopi Apong what time does the kitchen close?', {
  mentionedJids: [me],
});
const first = await aiAfter(0);
check(!!first && first.quotedId === tagId, 'a tag gets an answer quoting the member', first?.body);
const chat = (await api('GET', `/chats/${enc(GROUP)}`)).json?.chat;
check(chat?.assignedTo == null, 'the AI did not take the group chat', chat?.assignedTo);
check(
  (await events()).some((e) => e.payload.group.kind === 'answered'),
  'the chat shows "answered"',
);

// 2. An unrelated message gets no reply.
await say(ARJUN, 'Arjun Pillai', 'Who is joining on Saturday?');
check((await aiAfter(1, 4000)) === null, 'an unrelated message gets no reply');

// 3. A quote of an AI message (any member, no tag) gets an answer.
const quoteId = await say(ARJUN, 'Arjun Pillai', 'same time on Sunday?', { quotedId: first?.id });
const second = await aiAfter(1);
check(
  !!second && second.quotedId === quoteId,
  'a quote of an AI message gets an answer',
  second?.body,
);
check(
  (await events()).some((e) => e.payload.group.kind === 'answered' && e.payload.group.quoted),
  'the line says the member quoted the AI',
);

// 4. A quote of a teammate's message gets no reply.
const team = await api('POST', `/chats/${enc(GROUP)}/messages`, {
  text: 'See you all Saturday!',
  clientId: `check-${Date.now().toString(36)}`,
});
check(team.status >= 200 && team.status < 300, 'a teammate writes in the group', team.status);
await wait(2500);
const teamMsg = (await messages()).filter((m) => m.body === 'See you all Saturday!').at(-1);
const aiCount = (await aiMessages()).length;
await say(NURUL, 'Nurul Huda', 'thanks!', { quotedId: teamMsg?.id });
check((await aiAfter(aiCount, 4000)) === null, "a quote of a teammate's message gets no reply");

// 5. A change request: "A team member will reply soon." + hand-over line.
const changeId = await say(NURUL, 'Nurul Huda', '@Kopi Apong CHANGE my order to 3pm', {
  mentionedJids: [me],
});
const handover = await aiAfter(aiCount);
check(
  handover?.body === 'A team member will reply soon.' && handover?.quotedId === changeId,
  'a change request is handed over in the group',
  handover?.body,
);
check(
  (await events()).some((e) => e.payload.group.kind === 'handover'),
  'the chat shows the hand-over line',
);

// 6. Loop guard: after 10 AI messages in a row without a teammate, the AI pauses.
let count = (await aiMessages()).length;
let paused = false;
for (let i = 0; i < 14 && !paused; i++) {
  await say(NURUL, 'Nurul Huda', `@Kopi Apong question ${i}?`, { mentionedJids: [me] });
  const got = await aiAfter(count, 6000);
  if (got) count = (await aiMessages()).length;
  paused = (await events()).some((e) => e.payload.group.kind === 'paused');
}
const pausedLines = (await events()).filter((e) => e.payload.group.kind === 'paused').length;
check(paused && pausedLines === 1, 'the loop guard pauses the AI with one line', pausedLines);
const state = (await api('GET', `/chats/${enc(GROUP)}/ai-group`)).json;
check(state?.paused === true, 'Group info shows paused', JSON.stringify(state));

// 7. A teammate message ends the pause.
await api('POST', `/chats/${enc(GROUP)}/messages`, {
  text: 'I am here, ask me',
  clientId: `check-${Date.now().toString(36)}b`,
});
await wait(2500);
count = (await aiMessages()).length;
await say(NURUL, 'Nurul Huda', '@Kopi Apong one more?', { mentionedJids: [me] });
check(!!(await aiAfter(count)), 'after a teammate writes the AI answers again');

// 8. The group switched off: a tag gets no reply.
await api('PUT', `/chats/${enc(GROUP)}/ai-group`, { enabled: false });
count = (await aiMessages()).length;
await say(NURUL, 'Nurul Huda', '@Kopi Apong are you there?', { mentionedJids: [me] });
check((await aiAfter(count, 4000)) === null, 'a switched-off group gets no reply');

// 9. Try it with Group question sends nothing.
const tried = await api('POST', `/ai/agents/${agent.id}/try`, {
  question: 'what time does the kitchen close?',
  knowledge: { displayName: 'Aina', instructions: '', handoffRules: '' },
  group: true,
});
check(tried.status === 200 && tried.json?.ok, 'Try it answers a group question', tried.status);

console.log(failed ? `${failed} FAILED` : `ALL PASSED (${n} member messages)`);
process.exit(failed ? 1 : 0);
