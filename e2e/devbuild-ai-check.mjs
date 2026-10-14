// Real-model AI check on a Dev Build seeded by marketing-screenshots.mjs (fake WhatsApp, demo data).
// Usage:
//   node e2e/devbuild-ai-check.mjs <port> prep            unassign Farah's chat + add a delivery fact
//   node e2e/devbuild-ai-check.mjs <port> send ["text"]   send a fake customer message from Farah
//   node e2e/devbuild-ai-check.mjs <port> new <digits> "text" [profile]
//       a message from a fresh number (no earlier hand-off); `profile` saves demo details right away
//   node e2e/devbuild-ai-check.mjs <port> long <digits>
//   node e2e/devbuild-ai-check.mjs <port> enrichment <runner-temp-data-dir>
//   node e2e/devbuild-ai-check.mjs <port> handoff (isolated --mock-ai --handoff-check runner only)
//       a 24-message chat whose first message holds an order number, then an unassigned question
//       about it: the AI must read older messages to answer
// The owner signs in to the AI and turns the AI member on in between; `send`/`new` make real model
// calls. Record every run in docs/dev-build-checks.md.
const [port, command = 'prep', ...rest] = process.argv.slice(2);
if (
  !/^\d+$/.test(port ?? '') ||
  !['prep', 'send', 'new', 'long', 'enrichment', 'handoff'].includes(command)
)
  throw new Error(
    'Usage: node e2e/devbuild-ai-check.mjs <port> prep|send|new|long|enrichment|handoff …',
  );
const BASE = `http://127.0.0.1:${port}`;
const FARAH = '60123110021@s.whatsapp.net';
if (
  command === 'handoff' &&
  (await fetch(`${BASE}/api/health`)).headers.get('x-handoff-devbuild') !== 'mock-only'
)
  throw new Error('Use the isolated --mock-ai --handoff-check runner before signing in');

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE },
  body: JSON.stringify({ username: 'aisyah', password: 'demo-pass-123' }),
});
if (!login.ok) throw new Error(`login: ${login.status} (seed the Dev Build first)`);
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');

async function call(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: BASE, cookie },
    body: JSON.stringify(body),
  });
  console.log(method, path, res.status);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

if (command === 'handoff') {
  const { default: assert } = await import('node:assert/strict');
  const { io } = await import('socket.io-client');
  assert.equal((await fetch(`${BASE}/api/health`)).headers.get('x-handoff-devbuild'), 'mock-only');
  const clients = [];
  const connect = async (sessionCookie) => {
    const client = io(BASE, {
      transports: ['websocket'],
      extraHeaders: { Cookie: sessionCookie, Origin: BASE },
    });
    clients.push(client);
    const alerts = [];
    client.on('notification:new', (payload) => alerts.push(payload));
    await new Promise((done, fail) => {
      client.once('connect', done);
      client.once('connect_error', fail);
    });
    return alerts;
  };
  try {
    const adminAlerts = await connect(cookie);
    const meiLogin = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ username: 'mei', password: 'demo-pass-123' }),
    });
    assert.equal(meiLogin.status, 200);
    const meiCookie = meiLogin.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const meiAlerts = await connect(meiCookie);
    const settings = {
      displayName: 'Sales Agent',
      enabled: false,
      instructions: 'Hand over when a customer asks for a person.',
    };
    await call('PUT', '/ai', settings);
    await call('POST', '/ai/documents/text', {
      name: 'Demo shop',
      text: 'The fictional demo shop opens at 9am.',
    });
    await call('PUT', '/ai', { ...settings, enabled: true });
    const prefix = `601298${Date.now().toString().slice(-4)}`;
    for (const [suffix, mode] of [
      ['01', 'assigned'],
      ['02', 'unassigned'],
    ]) {
      const jid = `${prefix}${suffix}@s.whatsapp.net`;
      await call('POST', '/dev/fake-incoming', {
        chatJid: jid,
        senderName: 'Jay Demo',
        text: 'Could a person help me?',
      });
      let result;
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        result = await (
          await fetch(`${BASE}/api/chats/${encodeURIComponent(jid)}`, { headers: { cookie } })
        ).json();
        if (result.events?.some((event) => event.payload.handoff === 'asked_for_human')) break;
        await new Promise((done) => setTimeout(done, 250));
      }
      assert.ok(
        result.events.some((event) => event.payload.handoff === 'asked_for_human'),
        'Handoff did not complete',
      );
      await new Promise((done) => setTimeout(done, 250));
      const alertsFor = (alerts) =>
        alerts.filter((p) => p.tag === jid && p.title === 'Chat handed over');
      const pushes = (await call('GET', '/dev/handoff-deliveries')).deliveries.filter(
        (item) => item.payload.tag === jid && item.payload.title === 'Chat handed over',
      );
      assert.equal(result.chat.assignedTo, mode === 'assigned' ? 2 : null);
      assert.equal(alertsFor(meiAlerts).length, 1, `${mode}: teammate notification missing`);
      assert.equal(
        alertsFor(adminAlerts).length,
        mode === 'assigned' ? 0 : 1,
        `${mode}: admin targeting`,
      );
      assert.deepEqual(
        pushes.map((item) => item.userId),
        mode === 'assigned' ? [] : [3],
      );
      console.log(`PASS ${mode}: targeted connected-client notifications and offline push routing`);
    }
  } finally {
    await call('PUT', '/ai', { displayName: 'Sales Agent', enabled: false, instructions: '' });
    for (const client of clients) client.disconnect();
  }
} else if (command === 'enrichment') {
  // Owner sign-in AND explicit agreement are required before invoking this command.
  const { default: assert } = await import('node:assert/strict');
  const { readdir, readFile } = await import('node:fs/promises');
  const { join, resolve, basename } = await import('node:path');
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.headers.get('x-enrichment-devbuild'), 'real-ai');
  const dataDir = resolve(rest[0] ?? '');
  assert.match(basename(dataDir), /^ezychat-enrichment-devbuild-/);
  const events = async () => {
    const files = (await readdir(join(dataDir, 'logs'))).filter((name) => name.endsWith('.log'));
    const rows = (
      await Promise.all(files.map((name) => readFile(join(dataDir, 'logs', name), 'utf8')))
    )
      .join('\n')
      .split('\n');
    return rows.flatMap((row) => {
      try {
        const item = JSON.parse(row);
        return item.mod === 'enrichment' &&
          ['customer_enrichment', 'customer_enrichment_failed'].includes(item.event)
          ? [item]
          : [];
      } catch {
        return [];
      }
    });
  };
  const incoming = (jid, text) =>
    call('POST', '/dev/fake-incoming', {
      chatJid: jid,
      senderName: 'Fictional customer',
      text,
    });
  const profile = async (jid) =>
    (await call('GET', `/chats/${encodeURIComponent(jid)}/profile`)).profile;
  const scenario = async (name, jid, texts, expected) => {
    const before = (await events()).length;
    for (const text of texts) await incoming(jid, text);
    const deadline = Date.now() + 75_000;
    let completed;
    while (Date.now() < deadline) {
      const fresh = (await events()).slice(before);
      if (fresh.length) {
        completed = fresh.at(-1);
        break;
      }
      await new Promise((done) => setTimeout(done, 500));
    }
    assert.ok(completed, `${name}: completion timeout`);
    assert.equal(completed.event, 'customer_enrichment', `${name}: model failed`);
    const saved = await profile(jid);
    for (const [field, value] of Object.entries(expected))
      assert.equal(saved?.[field] ?? null, value, `${name}: ${field}`);
    const chat = (await call('GET', `/chats/${encodeURIComponent(jid)}`)).chat;
    assert.equal(chat.assignedTo, null, `${name}: assignment changed`);
    console.log(`PASS ${name}: ${completed.changed} fields changed`);
  };
  const status = await call('GET', '/ai/enrichment');
  assert.equal(status.connected, true);
  await call('PUT', '/ai/enrichment', { enabled: true });
  try {
    const prefix = `601299${Date.now().toString().slice(-4)}`;
    const demoJid = (suffix) => `${prefix}${suffix}@s.whatsapp.net`;
    const jay = demoJid('01');
    await scenario(
      'English four-field add',
      jay,
      [
        'My name is Jay Low. My company is Anchor Sprint. My email is jay@example.com. My address is 8 Jalan Baru, Penang.',
      ],
      {
        name: 'Jay Low',
        company: 'Anchor Sprint',
        email: 'jay@example.com',
        address: '8 Jalan Baru, Penang',
      },
    );
    await scenario(
      'Explicit email correction',
      jay,
      [
        'Correction: my current email is jay.new@example.com. Please replace my old email with this one.',
      ],
      { email: 'jay.new@example.com', name: 'Jay Low' },
    );
    await scenario(
      'Third-party and quoted details skipped',
      demoJid('02'),
      [
        'My colleague Farah Aziz works at Kopi Apong. Her email is farah@example.com and her address is 12 Jalan Lama. She wrote: "My name is Farah Aziz."',
      ],
      { name: null, company: null, email: null, address: null },
    );
    await scenario(
      'Negated and hypothetical details skipped',
      demoJid('03'),
      [
        'My name is not Amir. amir@example.com is not my email. If I worked at Example Company, I might use that address.',
      ],
      { name: null, company: null, email: null, address: null },
    );
    await scenario(
      'Malay self-report',
      demoJid('04'),
      [
        'Nama saya Aminah Yusof. Syarikat saya Aminah Bakes. E-mel saya aminah@example.com. Alamat saya 5 Jalan Melati, Penang.',
      ],
      {
        name: 'Aminah Yusof',
        company: 'Aminah Bakes',
        email: 'aminah@example.com',
        address: '5 Jalan Melati, Penang',
      },
    );
    await scenario(
      'Chinese self-report',
      demoJid('05'),
      [
        '我的名字是林美玲。我的公司是美玲烘焙。我的邮箱是meiling@example.com。我的地址是槟城花园路8号。',
      ],
      {
        name: '林美玲',
        company: '美玲烘焙',
        email: 'meiling@example.com',
        address: '槟城花园路8号',
      },
    );
    await scenario(
      'Split introduction burst',
      demoJid('06'),
      ['My name is Ravi Kumar.', 'My company is Ravi Supplies. My email is ravi@example.com.'],
      { name: 'Ravi Kumar', company: 'Ravi Supplies', email: 'ravi@example.com' },
    );
    const audit = await call('GET', '/audit');
    const changed = audit.entries.filter(
      (row) => row.action === 'customer.enrichment_update' && row.meta.chatJid?.startsWith(prefix),
    );
    assert.equal(changed.length, 5);
    const correction = changed.find(
      (row) => row.meta.chatJid === jay && row.meta.enrichment.fields.length === 1,
    );
    assert.equal(correction.meta.enrichment.fields[0].operation, 'replaced');
    assert.equal(correction.meta.enrichment.fields[0].threshold, 95);
    console.log(
      'PASS real-provider enrichment: seven scenarios; five audit events; no assignment changes',
    );
  } finally {
    await call('PUT', '/ai/enrichment', { enabled: false });
  }
} else if (command === 'prep') {
  // Demo chats all belong to teammates; the AI only claims unassigned chats and needs knowledge.
  await call('PATCH', `/chats/${encodeURIComponent(FARAH)}`, { assignedTo: null });
  await call('POST', '/ai/documents/text', {
    name: 'Delivery',
    text:
      'We deliver catering trays across Penang island and Seberang Perai. Delivery fee RM15 per ' +
      'order, free above RM300. Orders need 2 days notice. Payment by bank transfer or DuitNow.',
  });
} else if (command === 'send') {
  await call('POST', '/dev/fake-incoming', {
    chatJid: FARAH,
    senderName: 'Farah Aziz',
    text: rest[0] ?? 'Hi, can you deliver 3 trays of nasi lemak to me this Saturday?',
  });
} else if (command === 'new') {
  const [digits, message, profile] = rest;
  if (!/^\d{6,15}$/.test(digits ?? '') || !message)
    throw new Error('new <digits> "text" [profile]');
  const chatJid = `${digits}@s.whatsapp.net`;
  await call('POST', '/dev/fake-incoming', { chatJid, senderName: 'Customer', text: message });
  // The AI claims after ~10 s, so details saved now are in its first prompt.
  if (profile === 'profile')
    await call('PUT', `/chats/${encodeURIComponent(chatJid)}/profile`, {
      name: 'Aminah Yusof',
      company: 'Aminah Bakes',
      email: 'aminah@aminahbakes.example',
      otherPhone: '',
      address: 'Bayan Lepas, Penang',
      tags: ['VIP', 'Late payer'],
    });
} else if (command === 'long') {
  const [digits] = rest;
  if (!/^\d{6,15}$/.test(digits ?? '')) throw new Error('long <digits>');
  const chatJid = `${digits}@s.whatsapp.net`;
  const path = `/chats/${encodeURIComponent(chatJid)}`;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const customer = (text) =>
    call('POST', '/dev/fake-incoming', { chatJid, senderName: 'Customer', text });
  // A teammate replying keeps the chat with them, so the AI stays out until it is unassigned.
  let seq = 0;
  const teammate = (text) =>
    call('POST', `${path}/messages`, { text, clientId: `long-${digits}-${++seq}` });
  await customer('Hi, I placed an order yesterday, my order number is 4521.');
  await pause(300);
  await teammate('Thanks! I have noted order 4521.');
  for (let i = 1; i <= 11; i++) {
    await pause(300);
    await customer(`Also, question ${i} about the menu.`);
    await pause(300);
    await teammate(`Sure, answer ${i}.`);
  }
  await pause(300);
  await call('PATCH', path, { assignedTo: null });
  await pause(300);
  await customer('Sorry, what was my order number again?');
}
