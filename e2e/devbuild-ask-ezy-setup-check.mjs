// Dev Build check for Ask Ezy setting up agents and scheduled tasks (docs/features/ask-ezy-setup/design.md)
// against e2e/agents-devbuild.ts started with --max-agents 2 (mock model that calls the REAL Ask Ezy tools,
// fake WhatsApp, temp data). Usage: node e2e/devbuild-ask-ezy-setup-check.mjs <port>
import { apiClient, checker, poll } from './devbuild-client.mjs';

const PORT = Number(process.argv[2] ?? 7491);
const BASE = 'http://127.0.0.1:' + PORT;
const { check, finish } = checker();
const api = apiClient(BASE);

const health = await fetch(BASE + '/api/health');
if (health.headers.get('x-agents-devbuild') !== 'mock-ai')
  throw new Error('Run this only against e2e/agents-devbuild.ts (mock model)');

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);
await api('PUT', '/ai', { displayName: 'Sales Agent', enabled: false, instructions: '' });

const JEE = '60120000084@s.whatsapp.net';
const JEE_LIM = '60120005521@s.whatsapp.net';
await api('POST', '/dev/fake-incoming', {
  chatJid: JEE,
  text: 'Thanks for the update!',
  senderName: 'Jee Fong',
});
await api('POST', '/dev/fake-incoming', {
  chatJid: JEE_LIM,
  text: 'Can I change my order?',
  senderName: 'Jee Fong Lim',
});
await poll(async () => ((await api('GET', '/chats')).json?.chats ?? []).length >= 2, 15_000);

/** One Ask Ezy turn through the real route; returns the final answer (or the error event). */
const history = [];
async function ask(question) {
  const res = await fetch(BASE + '/api/ask-ezy', {
    method: 'POST',
    headers: { ...api.headers(), 'content-type': 'application/json' },
    body: JSON.stringify({ question, history }),
  });
  const events = (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const last = events.at(-1);
  history.push({ role: 'user', text: question });
  if (last?.type === 'answer') history.push({ role: 'assistant', text: last.answer.text });
  return last;
}
const block = (answer, type) => answer?.answer?.blocks?.find((b) => b.type === type);

// 1. Ezy asks which agent
const first = await ask('I want to create a new agent that greets Jee Fong at 9am every day');
const q1 = block(first, 'question');
check(
  q1 && q1.choices.includes('New agent') && q1.choices.includes('Sales Agent'),
  'Ezy asks: new agent or Sales Agent (choices)',
  JSON.stringify(first),
);

// 2. Ezy asks which Jee Fong, with the last 4 digits only
const second = await ask('New agent');
const q2 = block(second, 'question');
check(
  q2?.choices.length === 2 && q2.choices.every((c) => /…\d{4}$/.test(c) && !/60120/.test(c)),
  'Ezy asks which Jee Fong, with the last 4 digits only',
  JSON.stringify(q2),
);

// 3. Ezy proposes a new agent + a 09:00 task with a preview; nothing is created yet
const agentsBefore = (await api('GET', '/ai/agents')).json?.agents?.length ?? 0;
const third = await ask(q2?.choices.find((c) => c.endsWith('…0084')) ?? 'Jee Fong · …0084');
const agentCard = block(third, 'agent_proposal');
const taskCard = block(third, 'task_proposal');
check(agentCard?.status === 'proposed', 'a New agent card is proposed', JSON.stringify(agentCard));
check(
  taskCard?.time === '09:00' &&
    taskCard?.chatEnding === '0084' &&
    typeof taskCard?.preview === 'string',
  'a Scheduled task card for 09:00 to Jee Fong …0084, with a preview',
  JSON.stringify(taskCard),
);
check(
  ((await api('GET', '/ai/agents')).json?.agents?.length ?? 0) === agentsBefore,
  'nothing is created before Apply',
);

// 4. Apply both: the agent is created switched off, the task is saved
const applied = await api('POST', `/ask-ezy/changes/${taskCard?.id}/apply`);
check(applied.status === 200, 'Apply both answers 200', applied.status);
const agents = (await api('GET', '/ai/agents')).json?.agents ?? [];
const greeter = agents.find(
  (a) => a.name === 'Morning greeter' || a.displayName === 'Morning greeter',
);
check(
  greeter && greeter.enabled === false,
  'the new agent exists, switched off',
  JSON.stringify(greeter),
);
const greeterSetup = greeter ? (await api('GET', `/ai/agents/${greeter.id}`)).json : null;
check(
  greeter?.preset === 'custom' &&
    greeter?.answerDirect === false &&
    /good-morning greeting/.test(greeterSetup?.settings?.instructions ?? '') &&
    /do not answer chats/.test(greeterSetup?.settings?.instructions ?? ''),
  'the new agent is custom, never answers direct chats, and its instructions come from its purpose',
  JSON.stringify({ greeter, instructions: greeterSetup?.settings?.instructions?.slice(0, 200) }),
);
const tasks = greeter
  ? ((await api('GET', `/ai/agents/${greeter.id}/scheduled-tasks`)).json?.tasks ?? [])
  : [];
check(
  tasks.length === 1 && tasks[0].time === '09:00' && tasks[0].chat?.jid === JEE,
  'the task is saved: 09:00 to Jee Fong …0084',
  JSON.stringify(tasks),
);

// 5. Update: move it to 8:30
const fourth = await ask('Move the morning greeting to 8:30');
const edit = block(fourth, 'task_proposal');
check(edit?.time === '08:30', 'Ezy proposes the change 09:00 → 08:30', JSON.stringify(edit));
const editApplied = await api('POST', `/ask-ezy/changes/${edit?.id}/apply`);
check(editApplied.status === 200, 'the change applies', editApplied.status);
const after = greeter
  ? ((await api('GET', `/ai/agents/${greeter.id}/scheduled-tasks`)).json?.tasks ?? [])
  : [];
check(after[0]?.time === '08:30', 'the task now runs at 08:30', JSON.stringify(after));

finish();
