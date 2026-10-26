// Dev Build check for the Google Calendar connector against e2e/agents-devbuild.ts (mock model, fake
// WhatsApp, fake Google, temp data). Start the runner without --max-inboxes, then:
//   node e2e/devbuild-calendar-check.mjs <port>
// Prints PASS/FAIL per step; never calls Google, a model or a real WhatsApp number.
const PORT = Number(process.argv[2] ?? 7491);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)
  throw new Error('The port must be an integer between 1024 and 65535.');
const BASE = `http://127.0.0.1:${PORT}`;
/** Only this local Dev Build: links the server hands back must point at it. */
const local = (link) => {
  const url = new URL(link, BASE);
  if (url.origin !== BASE) throw new Error('Refusing a link outside the local Dev Build');
  return url.href;
};
let failed = 0;
const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ');
const check = (ok, step, detail = '') => {
  if (!ok) failed++;
  const extra = detail ? '  (' + oneLine(detail) + ')' : '';
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + step + extra);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await fetch(BASE + '/api/health');
if (health.headers.get('x-agents-devbuild') !== 'mock-ai')
  throw new Error('Run this only against e2e/agents-devbuild.ts (mock model)');

let cookie = '';
async function api(method, path, body) {
  const res = await fetch(BASE + '/api' + path, {
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
const code = (r) => r.json?.error?.code ?? r.json?.error;

/** The newest AI message in a chat after `after` AI messages, once sent, within `ms`, or null. */
async function aiReply(jid, aiUserId, after, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const res = await api('GET', `/chats/${encodeURIComponent(jid)}/messages`);
    const mine = (res.json?.messages ?? []).filter((m) => m.sentByUserId === aiUserId);
    // Wait until it went out: a customer message while it is queued cancels it (and the AI answers again).
    if (mine.length > after && mine.at(-1).status !== 'pending') return mine.at(-1);
    await wait(500);
  }
  return null;
}
async function say(jid, text) {
  await api('POST', '/dev/fake-incoming', { chatJid: jid, text, senderName: 'Mei Ying' });
}
const events = async () => (await api('GET', '/dev/fake-google-calendar')).json.events;
const activity = async () =>
  (await api('GET', '/connectors/google-calendar/activity')).json.activity;
const agentBody = (enabled) => ({
  displayName: 'Kopi Apong AI',
  enabled,
  instructions: '',
  handoffRules: '',
});
const BOOKINGS = 'bookings-demo@group.calendar.google.com';
const RULES = {
  calendarId: BOOKINGS,
  checkFree: true,
  book: true,
  title: 'Table booking',
  lengthMin: 90,
  days: [0, 1, 2, 3, 4, 5, 6],
  from: '08:00',
  to: '22:00',
  gapMin: 0,
  noticeHours: 2,
  maxDays: 14,
};

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);
await api('PUT', '/ai', agentBody(false));
const agent = (await api('GET', '/ai')).json.agents[0];
check(!!agent, 'the AI agent exists', agent?.id);

// 1. Sign in: the consent page (fake Google) → Allow → our loopback callback.
let status = (await api('GET', '/connectors/google-calendar')).json;
check(
  status.state === 'disconnected',
  'starts disconnected (the fake Google app is configured)',
  status.state,
);
const start = (await api('POST', '/connectors/google-calendar/connect')).json;
const consent = await (await fetch(local(start.authorizationUrl))).text();
const allow = /id="allow" href="([^"]+)"/.exec(consent)?.[1]?.replaceAll('&#38;', '&');
check(!!allow, 'the consent page offers Allow', start.authorizationUrl);
const back = await fetch(local(allow));
check(back.status === 200, 'Google returns to the loopback callback', back.status);
const progress = (await api('GET', `/connectors/google-calendar/connect/${start.requestId}`)).json;
check(
  progress.status === 'done',
  'the waiting page learns the sign-in is done',
  JSON.stringify(progress),
);
status = (await api('GET', '/connectors/google-calendar')).json;
check(
  status.state === 'connected' &&
    status.account &&
    status.calendars.some((c) => c.id === BOOKINGS && !c.readOnly) &&
    status.calendars.some((c) => c.readOnly),
  'connected: the account and its calendars (one read only)',
  JSON.stringify({ state: status.state, n: status.calendars.length }),
);
check(!JSON.stringify(status).includes('token'), 'no token reaches the browser');
const replay = await fetch(local(allow));
check(replay.status >= 400, 'the same callback link cannot be used twice', replay.status);

// 2. Booking rules; booking with a read-only calendar or without free times is refused.
check(
  (
    await api('PUT', `/connectors/google-calendar/agents/${agent.id}`, {
      ...RULES,
      checkFree: false,
    })
  ).status === 400,
  'Book appointments without Check free times is refused (400)',
);
const saved = await api('PUT', `/connectors/google-calendar/agents/${agent.id}`, RULES);
check(saved.status === 200 && saved.json.book === true, 'booking rules saved', saved.status);
const on = await api('PUT', `/ai/agents/${agent.id}`, agentBody(true));
check(
  on.status === 200 && on.json.agent.enabled,
  'the agent turns on (the calendar counts as a source)',
  code(on) ?? on.status,
);

// 3. A customer asks to book: free times, then the confirmed time is booked once.
const jid = `6012${String(Date.now()).slice(-7)}@s.whatsapp.net`;
await say(jid, 'Hi, can I BOOK a table for 4?');
const offer = await aiReply(jid, agent.userId, 0);
check(
  /^Free: .+Shall I book it\?$/.test(offer?.body ?? ''),
  'the AI offers a free time from the calendar',
  offer?.body,
);
await say(jid, 'Yes please, CONFIRM that time');
const booked = await aiReply(jid, agent.userId, 1);
check(/^Booked: /.test(booked?.body ?? ''), 'the AI books the confirmed time', booked?.body);
let list = await events();
check(
  list.length === 1 &&
    list[0].calendarId === BOOKINGS &&
    String(list[0].summary).startsWith('Table booking'),
  'one event in the Bookings calendar, titled from the rules',
  JSON.stringify(list.map((e) => ({ c: e.calendarId, s: e.summary }))),
);
const detail = (await api('GET', `/chats/${encodeURIComponent(jid)}`)).json;
const lines = (detail.events ?? [])
  .filter((e) => e.type === 'ai_tool_used')
  .map((e) => JSON.stringify(e.payload));
check(
  lines.some((l) => l.includes('"checked"')) && lines.some((l) => l.includes('"booked"')),
  'the chat shows "AI checked free times" and "AI booked …"',
  lines.length,
);
await say(jid, 'CONFIRM again just to be sure');
const again = await aiReply(jid, agent.userId, 2);
check(
  /^Already booked: /.test(again?.body ?? '') && (await events()).length === 1,
  'a second confirm books nothing new',
  again?.body,
);
const acts = await activity();
check(
  acts.some((a) => a.kind === 'checked') && acts.some((a) => a.kind === 'booked' && a.start),
  'Activity lists the check and the booking (no chat text)',
  acts.map((a) => a.kind).join(','),
);
check(
  !JSON.stringify(acts).includes('CONFIRM') && !JSON.stringify(acts).includes('BOOK a'),
  'Activity keeps no customer text',
);

// 4. The offered time became busy meanwhile: re-checked, nothing booked.
const jid2 = `6013${String(Date.now()).slice(-7)}@s.whatsapp.net`;
await say(jid2, 'BOOK for 2 tonight?');
const offer2 = await aiReply(jid2, agent.userId, 0);
check(
  /^Free: /.test(offer2?.body ?? '') && offer2.body !== offer?.body,
  'a second chat is offered another time (the booked one is busy now)',
  offer2?.body,
);
const offers = (await api('GET', '/dev/fake-google-calendar')).json;
const busyFrom = new Date(Date.now()).toISOString();
const busyTo = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
await api('POST', '/dev/fake-google-calendar', { busy: [{ start: busyFrom, end: busyTo }] });
await say(jid2, 'CONFIRM');
const refused = await aiReply(jid2, agent.userId, 1);
check(
  !/^Booked/.test(refused?.body ?? '') && (await events()).length === offers.events.length,
  'a time that became busy is not booked',
  refused?.body,
);
await api('POST', '/dev/fake-google-calendar', { busy: [] });

// 5. Booking off: the AI may offer times but has no booking tool.
await api('PUT', `/connectors/google-calendar/agents/${agent.id}`, { ...RULES, book: false });
const jid3 = `6014${String(Date.now()).slice(-7)}@s.whatsapp.net`;
await say(jid3, 'BOOK please');
await aiReply(jid3, agent.userId, 0);
await say(jid3, 'CONFIRM');
const off = await aiReply(jid3, agent.userId, 1);
check(off?.body === 'book=not-offered', 'booking off: the booking tool is not offered', off?.body);

// 6. Google refuses the sign-in: expired, the AI has no calendar tools, the agent page says so.
await api('POST', '/dev/fake-google-calendar', { state: 'expired' });
status = (await api('GET', '/connectors/google-calendar')).json;
check(
  status.state === 'expired' && status.problemSince,
  'a refused sign-in shows as expired',
  status.state,
);
const jid4 = `6015${String(Date.now()).slice(-7)}@s.whatsapp.net`;
await say(jid4, 'BOOK a table');
const expired = await aiReply(jid4, agent.userId, 0, 15_000);
check(
  !/^Free: /.test(expired?.body ?? ''),
  'while expired the AI offers no times',
  expired?.body ?? 'no AI message',
);
await api('POST', '/dev/fake-google-calendar', { state: 'ok' });

// 7. Disconnect: back to disconnected, the rules stay, events stay in Google.
const off2 = await api('POST', '/connectors/google-calendar/disconnect');
check(off2.status === 200 && off2.json.state === 'disconnected', 'Disconnect', off2.json?.state);
const kept = (await api('GET', `/connectors/google-calendar/agents/${agent.id}`)).json;
check(kept.calendarId === BOOKINGS, 'booking rules are kept for the next sign-in', kept.calendarId);
check((await events()).length >= 1, 'events already in Google stay');

console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
