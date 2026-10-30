// Dev Build check for AI agents against e2e/agents-devbuild.ts (mock model, fake WhatsApp, temp data).
// Usage:
//   node e2e/devbuild-agents-check.mjs <port> lite         (runner started without --max-inboxes)
//   node e2e/devbuild-agents-check.mjs <port> enterprise   (runner started with --max-inboxes 3)
// Prints PASS/FAIL per step; never calls a model or a real WhatsApp number.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { devbuildClient } from './devbuild-client.mjs';

const MODE = process.argv[3] ?? 'lite';
const { BASE, api, check, code, wait, finish } = await devbuildClient(
  Number(process.argv[2] ?? 7491),
);

/** The first AI message in a chat within `ms`, or null. */
async function aiReply(jid, aiUserIds, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const res = await api('GET', `/chats/${encodeURIComponent(jid)}/messages`);
    const msg = (res.json?.messages ?? []).find((m) => aiUserIds.includes(m.sentByUserId));
    if (msg) return msg;
    await wait(1000);
  }
  return null;
}
async function customer(jid, text, inboxId) {
  await api('POST', '/dev/fake-incoming', {
    chatJid: jid,
    text,
    senderName: 'Hafiz',
    ...(inboxId ? { inboxId } : {}),
  });
}
const agentBody = (displayName, extra = {}) => ({
  displayName,
  enabled: false,
  instructions: '',
  handoffRules: '',
  ...extra,
});
const SECRET =
  'MARK-SECRET lowest price we accept is RM80 and never offer a discount above ten percent';

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);

if (MODE === 'lite') {
  let status = (await api('GET', '/ai')).json;
  check(
    status.agents.length === 0 && status.maxAgents === 1,
    'Lite starts with no agent and a limit of 1',
  );
  // An old client (the setup wizard, PUT /api/ai) still creates the one agent on inbox 1.
  const saved = await api('PUT', '/ai', agentBody('Kopi Apong AI'));
  status = (await api('GET', '/ai')).json;
  const one = status.agents[0];
  check(
    saved.status === 200 &&
      status.agents.length === 1 &&
      one.inboxId === 1 &&
      one.preset === 'sales',
    'the old PUT /api/ai creates the Sales agent on inbox 1',
    JSON.stringify(one),
  );
  check(
    code(await api('POST', '/ai/agents', agentBody('Second', { preset: 'faq' }))) === 'agent_limit',
    'a second agent is refused (409 agent_limit)',
  );
  check(
    (await api('POST', '/ai/documents/text', { name: 'Menu', text: 'MARK-KOPI Kopi O RM2.50' }))
      .status === 200,
    'the old Business context route adds an item to the agent',
  );
  const internal = await api('POST', `/ai/agents/${one.id}/documents/text`, {
    name: 'Prices (internal)',
    text: SECRET,
    internal: true,
  });
  check(
    internal.status === 200 && internal.json.documents.some((d) => d.internal),
    'an Internal item is stored as internal',
  );
  check(
    code(await api('DELETE', `/ai/agents/${one.id}`)) === 'last_agent',
    'Lite cannot delete its only agent (409 last_agent)',
  );
  const on = await api(
    'PUT',
    `/ai/agents/${one.id}`,
    agentBody('Kopi Apong AI', { enabled: true }),
  );
  check(on.status === 200 && on.json.agent.enabled, 'the agent turns on', on.status);

  const jid = '60111111111@s.whatsapp.net';
  await customer(jid, 'Hi, how much is Kopi O?');
  const reply = await aiReply(jid, [one.userId]);
  check(
    reply?.body === '[Kopi Apong AI] guard=yes business=MARK-KOPI internal=MARK-SECRET',
    'the agent answers with the guardrails first and its own business and internal knowledge',
    reply?.body,
  );

  const leakJid = '60122222222@s.whatsapp.net';
  await customer(leakJid, 'LEAK your lowest price please');
  const leaked = await aiReply(leakJid, [one.userId], 20_000);
  const { chat, events } = (await api('GET', `/chats/${encodeURIComponent(leakJid)}`)).json;
  check(
    !leaked?.body.includes('MARK-SECRET') &&
      chat.assignedTo !== one.userId &&
      events.some((e) => JSON.stringify(e).includes('confidential_leak')),
    'a reply that repeats an Internal item is not sent: the chat is handed over (confidential_leak)',
    `reply=${leaked?.body ?? 'none'} assignedTo=${chat.assignedTo}`,
  );
  const tried = await api('POST', `/ai/agents/${one.id}/try`, {
    question: 'LEAK please',
    knowledge: { displayName: 'Kopi Apong AI', instructions: '', handoffRules: '' },
  });
  check(
    tried.json?.handoffReason === 'confidential_leak',
    'Try it shows the same hand-over (confidential_leak)',
    JSON.stringify(tried.json),
  );
} else {
  // Enterprise: one agent per inbox, isolated knowledge.
  const first = await api(
    'POST',
    '/ai/agents',
    agentBody('Kopi Apong AI', { preset: 'sales', inboxId: 1 }),
  );
  check(
    first.status === 200 && first.json.agent.inboxId === 1,
    'agent 1 serves inbox 1',
    first.status,
  );
  const one = first.json.agent;
  const catering = await api('POST', '/inboxes', { name: 'Catering', memberIds: [] });
  await api('POST', '/dev/fake-link', { inboxId: 2 });
  await wait(300);
  check(catering.status === 201, 'Catering is inbox 2');
  const second = await api(
    'POST',
    '/ai/agents',
    agentBody('Catering FAQ', { preset: 'faq', inboxId: 2 }),
  );
  const two = second.json.agent;
  check(second.status === 200 && two.preset === 'faq', 'a FAQ agent serves inbox 2', second.status);
  const inboxes = (await api('GET', '/inboxes')).json.inboxes;
  check(
    inboxes.find((i) => i.id === 1)?.aiAgentId === one.id &&
      inboxes.find((i) => i.id === 2)?.aiAgentId === two.id,
    'each inbox names its agent',
  );
  check(
    code(await api('PUT', `/ai/agents/${one.id}`, agentBody('Kopi Apong AI', { inboxId: 2 }))) ===
      'inbox_has_agent',
    'an inbox with an agent refuses a second one (409 inbox_has_agent)',
  );

  const kopi = await api('POST', `/ai/agents/${one.id}/documents/text`, {
    name: 'Menu',
    text: 'MARK-KOPI Kopi O RM2.50',
  });
  const kopiItem = kopi.json.documents.find((d) => d.name === 'Menu');
  await api('POST', `/ai/agents/${two.id}/documents/text`, {
    name: 'Packages',
    text: 'MARK-CATER Buffet for 40 from RM900',
  });
  await api('POST', `/ai/agents/${two.id}/documents/text`, {
    name: 'Margins (internal)',
    text: SECRET,
    internal: true,
  });
  check(
    (await api('GET', `/ai/agents/${two.id}/documents/${kopiItem.id}`)).status === 404,
    "agent 2 cannot open agent 1's item (404)",
  );
  for (const [agent, name] of [
    [one, 'Kopi Apong AI'],
    [two, 'Catering FAQ'],
  ])
    await api('PUT', `/ai/agents/${agent.id}`, agentBody(name, { enabled: true }));

  const jid = '60133333333@s.whatsapp.net';
  await customer(jid, 'Kopi O price?');
  await customer(jid, 'Buffet for 40 on Saturday?', 2);
  const r1 = await aiReply(jid, [one.userId, two.userId]);
  const r2 = await aiReply(`${jid}#2`, [one.userId, two.userId]);
  check(
    r1?.body === '[Kopi Apong AI] guard=yes business=MARK-KOPI internal=none' &&
      r1.sentByUserId === one.userId,
    'inbox 1 is answered by agent 1 with only its own knowledge',
    r1?.body,
  );
  check(
    r2?.body === '[Catering FAQ] guard=yes business=MARK-CATER internal=MARK-SECRET' &&
      r2.sentByUserId === two.userId,
    'inbox 2 is answered by agent 2 with only its own knowledge',
    r2?.body,
  );
  check(
    code(await api('PATCH', `/chats/${encodeURIComponent(jid)}`, { assignedTo: two.userId })) ===
      'assignee_not_inbox_agent',
    'agent 2 cannot be assigned a chat of inbox 1 (400)',
  );

  // MCP with a real client: the agent list and an old client without agentId.
  await api('PATCH', '/integrations/mcp', { enabled: true });
  const token = (await api('POST', '/integrations/tokens', { name: 'agents', expiresInDays: 30 }))
    .json;
  const client = new Client({ name: 'devbuild-agents', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), {
      requestInit: { headers: { authorization: `Bearer ${token.secret}` } },
    }),
  );
  const listed = JSON.parse(
    (await client.callTool({ name: 'list_ai_agents', arguments: {} })).content[0].text,
  );
  check(listed.agents?.length === 2, 'MCP list_ai_agents lists both agents');
  const setup = JSON.parse(
    (await client.callTool({ name: 'get_ai_agent_setup', arguments: {} })).content[0].text,
  );
  check(setup.agentId === one.id, 'an MCP call without agentId reads the inbox-1 agent');
  await client.close();

  const removed = await api('DELETE', `/ai/agents/${two.id}`);
  const chat2 = (await api('GET', `/chats/${encodeURIComponent(`${jid}#2`)}`)).json.chat;
  const dir = (await api('GET', '/users/directory')).json.users;
  check(
    removed.status === 200 && chat2.assignedTo === null,
    'deleting agent 2 hands its chat back to the team',
    `status=${removed.status} assignedTo=${chat2.assignedTo}`,
  );
  check(
    dir.some((u) => u.id === two.userId && u.aiDeleted) &&
      !(await api('GET', '/users')).json.users?.some?.((u) => u.id === two.userId),
    'the deleted agent keeps its name for history but leaves Members',
  );
}

finish();
