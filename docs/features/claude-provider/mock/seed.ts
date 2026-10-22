import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../packages/server/src/context.js';
import { createInboxSendPort } from '../../../../packages/server/src/mcp/send.js';

/** Fictional data through the existing services and API, never a real linked WhatsApp account. */
export async function seedDemo(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const auth = ctx.services.auth!;
  const password = 'demo-pass-123';
  const users = [
    { username: 'aisyah', displayName: 'Aisyah', role: 'admin' as const },
    { username: 'daniel', displayName: 'Daniel', role: 'agent' as const },
    { username: 'meiling', displayName: 'Mei Ling', role: 'agent' as const },
  ].map((user) => auth.createUser({ ...user, password, mustChangePassword: false }));
  const origin = `http://127.0.0.1:${ctx.config.port}`;
  const cookie = `sid=${auth.createSession(users[0]!.id, { ip: '127.0.0.1', userAgent: 'reference-seed' })}`;
  const call = async (method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown) => {
    const response = await app.inject({
      method,
      url: `/api${path}`,
      headers: { host: new URL(origin).host, origin, cookie, 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });
    if (response.statusCode >= 400) throw new Error(`Seed ${path}: ${response.statusCode}`);
    return response.json();
  };
  for (const [shortcut, body] of [
    ['hours', 'We open daily 8am–10pm. Kitchen closes at 9.30pm.'],
    ['delivery', 'Delivery within 5 km of Georgetown. Free above RM40.'],
    ['menu', 'Kopi O RM3.50 · Teh Tarik RM4 · Nasi Lemak Ayam RM12.'],
  ])
    await call('POST', '/quick-replies', { shortcut, body });
  await call('PATCH', '/ai/connection', {
    mode: 'api',
    model: '',
    apiKey: 'sk-demo-placeholder-not-a-key',
  });
  const ai = ctx.services.ai!.status();
  await call('PUT', '/ai', {
    displayName: 'Aina', // custom-agents: the server's AI member is agent 1 (Aina) of the mock.
    enabled: false,
    instructions: ai.settings.instructions,
    handoffRules: ai.settings.handoffRules,
  });
  await call('POST', '/ai/documents/text', {
    name: 'Menu and opening hours',
    text: 'Kopi Apong opens daily 8am–10pm. Kopi O RM3.50, Teh Tarik RM4, Nasi Lemak Ayam RM12. Delivery within 5 km of Georgetown, free above RM40.',
  });
  const chats = [
    [
      '60123110021@s.whatsapp.net',
      'Farah Catering Co',
      'Can I book catering for 30 people this Saturday?',
    ],
    ['60125550142@s.whatsapp.net', 'Ahmad Zulkifli', 'Is the shop open on Hari Raya?'],
    ['60127020388@s.whatsapp.net', 'Tan Wei Jie', '你好，请问可以送到 Gurney Drive 吗？'],
    ['60128814455@s.whatsapp.net', 'Priya Nair', 'My order #1042 has not arrived yet.'],
    ['60129001234@s.whatsapp.net', 'Jason Lim', 'How much is a large Kopi Peng?'],
    ['60126677889@s.whatsapp.net', 'Nurul Huda', 'Can I order two Nasi Lemak for pickup at 1pm?'],
  ];
  for (const [chatJid, senderName, text] of chats)
    await call('POST', '/dev/fake-incoming', { chatJid, senderName, text });
  await call('PUT', `/chats/${encodeURIComponent(chats[0]![0]!)}/profile`, {
    name: 'Farah Aziz',
    company: 'Farah Catering Co',
    email: 'orders@farahcatering.example',
    address: 'Georgetown, Penang',
    tags: ['VIP', 'Catering'],
  });
  await call('PATCH', `/chats/${encodeURIComponent(chats[0]![0]!)}`, { assignedTo: users[2]!.id });
  await call('POST', `/chats/${encodeURIComponent(chats[0]![0]!)}/notes`, {
    body: 'Repeat customer. Confirm the catering deposit with staff.',
  });
  await call('PATCH', `/chats/${encodeURIComponent(chats[1]![0]!)}`, { status: 'resolved' });
  const groupJid = '120363025550001@g.us';
  await call('POST', '/dev/fake-group', {
    groupJid,
    name: 'Kopi Apong Regulars',
    generated: 12,
    members: [
      {
        phone: '60123110021',
        name: 'Farah Aziz',
        role: 'admin',
        about: 'Farah Catering Co, Penang',
      },
      { phone: '60126677889', name: 'Nurul Huda' },
    ],
  });
  await call('POST', '/dev/fake-incoming', {
    chatJid: groupJid,
    senderJid: '60123110021@s.whatsapp.net',
    senderName: 'Farah Aziz',
    text: 'Is the durian cendol back this weekend?',
  });
  // Proposed (MCP send): an assistant token that may send, and one reply it sent through the real
  // send port, so the token list badge and the "via AI assistant" line show without a real AI client.
  const created = await call('POST', '/integrations/tokens', {
    name: 'Claude – office laptop',
    expiresInDays: 90,
    canSend: true,
  });
  await call('POST', '/integrations/tokens', { name: 'ChatGPT – reports only', expiresInDays: 30 });
  // Proposed (MCP send to a new number): a token that may also message new numbers, and one chat it
  // started with a number that was not in the inbox (the customer has not written yet).
  const outreach = await call('POST', '/integrations/tokens', {
    name: 'Claude – event follow-ups',
    expiresInDays: 30,
    canSend: true,
    canMessageNewNumbers: true,
  });
  const resolved = ctx.services.apiTokens!.resolve(created.secret as string);
  if (!resolved.ok) throw new Error('seed token');
  createInboxSendPort(ctx).sendText(resolved.principal, {
    jid: chats[0]![0]!,
    text: 'Yes, we can cater for 30 this Saturday. The set is RM12 per person; I will confirm the deposit today.',
    requestId: 'seed-assistant-0001',
  });
  const outreachToken = ctx.services.apiTokens!.resolve(outreach.secret as string);
  if (!outreachToken.ok) throw new Error('seed outreach token');
  await createInboxSendPort(ctx).sendToNewNumber(outreachToken.principal, {
    phone: '+60 13-999 0001',
    text: 'Hi, this is Aisyah. Thank you for visiting our booth at the food fair. As you asked, here is our catering menu: https://example.com/menu',
    requestId: 'seed-assistant-new-0001',
  });
}
