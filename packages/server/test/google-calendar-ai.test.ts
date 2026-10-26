import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BOOKING_SETTINGS, type AiTryResult, type BookingSettings } from '@ezychat/shared';
import type { ToolSet } from 'ai';
import { listAgents } from '../src/ai/agents.js';
import { createAiService, AI_FALLBACK_MS } from '../src/ai/service.js';
import { HANDOFF_REPLY } from '../src/ai/prompt.js';
import type { AiPrompt, AiProvider } from '../src/ai/provider-types.js';
import type { AiToolCallEvent } from '../src/index.js';
import { mergeChat } from '../src/chats/merge.js';
import type { AppContext } from '../src/context.js';
import { createMessageService } from '../src/messages/service.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { makeTestApp, type TestApp } from './helpers.js';

const BOOKINGS = 'bookings-demo@group.calendar.google.com';
const jid = '60123456789@s.whatsapp.net';
// Monday 26 Oct 2026, 9:50 in Kuala Lumpur (the default AI time zone): with the 2-hour notice,
// 12:00 stays the first free time while the test's turns move the clock a little.
const MONDAY_KL = new Date('2026-10-26T01:50:00Z');

type Decision = { reply: string; action: 'answer' | 'handoff'; handoffReason?: string | null };
type Script = (tools: ToolSet, signal: AbortSignal) => Promise<Decision>;

let t: TestApp;
let provider: AiProvider;
let script: Script;
let adminId: number;
let agentId: number;

/** Calls one tool as the AI SDK would; a thrown error is swallowed like the SDK reports it to the model. */
async function call(
  tools: ToolSet,
  name: string,
  input: object,
  signal: AbortSignal,
): Promise<string> {
  const execute = tools[name]?.execute as
    ((input: object, options: object) => Promise<string>) | undefined;
  if (!execute) throw new Error(`tool ${name} not offered`);
  return execute(input, { toolCallId: `call-${name}`, messages: [], abortSignal: signal });
}

const freeTimes = (output: string) =>
  (JSON.parse(output) as { freeTimes: Array<{ start: string; time: string }> }).freeTimes;

async function connectCalendar(ctx: AppContext) {
  const svc = ctx.services.googleCalendar!;
  const start = svc.startConnect('http://127.0.0.1:7420/api/connectors/google-calendar/callback', {
    userId: adminId,
    ip: null,
  });
  const state = new URL(start.authorizationUrl).searchParams.get('state')!;
  const target = new URL(svc.fakeConsent(state, true)!);
  const page = await svc.callback(Object.fromEntries(target.searchParams));
  expect(page.status).toBe(200);
}

const saveBooking = (patch: Partial<BookingSettings> = {}) =>
  t.ctx.services.googleCalendar!.putSettings(
    agentId,
    { ...DEFAULT_BOOKING_SETTINGS, calendarId: BOOKINGS, ...patch },
    { userId: adminId, ip: null },
  );

async function setUp({
  context = false,
  connect = true,
  booking = {} as Partial<BookingSettings>,
} = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(MONDAY_KL);
  provider = {
    generate: vi.fn(async (_s, _k, prompt: AiPrompt, signal: AbortSignal) =>
      script(prompt.tools ?? {}, signal),
    ) as AiProvider['generate'],
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  t = await makeTestApp({
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
      ctx.services.messages!.shutdown();
      ctx.services.messages = createMessageService(ctx, {
        now: () => Date.now(),
        queue: { spacingMs: 0 },
      });
      ctx.services.ai = createAiService(ctx, { provider, isOnline: () => true });
    },
  });
  const admin = t.ctx.services.auth!.createUser({
    username: 'admin',
    displayName: 'Admin',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  adminId = admin.id;
  const actor = { userId: adminId, ip: null };
  const ai = t.ctx.services.ai!;
  ai.saveConnection({ mode: 'api', model: '', apiKey: 'test-api-key-123' }, actor);
  ai.saveMember({ displayName: 'Aina', enabled: false, instructions: '' }, actor);
  agentId = listAgents(t.ctx.db)[0]!.id;
  if (context) ai.addText(null, { name: 'Business context', text: 'We open 10 to 6.' }, actor);
  if (connect) {
    await connectCalendar(t.ctx);
    await saveBooking(booking);
  }
  return actor;
}

async function customerSays(id: string, text: string) {
  await getMessages(t.ctx).ingest(
    {
      id,
      chatJid: jid,
      body: text,
      type: 'text',
      fromMe: false,
      senderJid: jid,
      senderName: 'Mei Ying',
      timestamp: Date.now(),
      quotedId: null,
      media: null,
    },
    'live',
  );
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS + 1500);
}

/** The team saved this customer's email (and name) in the contact. */
function saveContact(email: string, name = 'Mei Ying') {
  t.ctx.services.customers!.save(
    jid,
    { name, company: '', email, otherPhone: '', address: '', tags: [] },
    { userId: adminId, ip: null },
  );
}

const offeredTools = () =>
  vi.mocked(provider.generate).mock.calls.map((c) => Object.keys(c[2].tools ?? {}).sort());
const activity = () =>
  (
    t.ctx.db.prepare('SELECT kind FROM calendar_activity ORDER BY id').all() as Array<{
      kind: string;
    }>
  ).map((r) => r.kind);
const toolEvents = () =>
  getChats(t.ctx)
    .events(jid)
    .filter((e) => e.type === 'ai_tool_used')
    .map((e) => e.payload);
const fake = () => t.ctx.services.googleCalendar!.fake!;

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(async () => {
  await t?.close();
  vi.useRealTimers();
});

describe('Google Calendar AI tools (live)', () => {
  it('turns the agent on with only a calendar, offers free times, then books the confirmed one', async () => {
    const actor = await setUp({ booking: { book: true } });
    // no Business context: the calendar alone counts as facts
    t.ctx.services.ai!.saveMember({ displayName: 'Aina', enabled: true, instructions: '' }, actor);
    const events: AiToolCallEvent[] = [];
    t.ctx.bus.on('ai:tool_call', (event) => events.push(event));
    let offered: Array<{ start: string; time: string }> = [];
    let sameTurnBooking = '';
    script = async (tools, signal) => {
      offered = freeTimes(await call(tools, 'check_free_times', {}, signal));
      // booking in the same turn as the offer: the customer has not chosen yet
      sameTurnBooking = await call(tools, 'book_appointment', { start: offered[0]!.start }, signal);
      return { reply: `Free: ${offered[0]!.time}`, action: 'answer' };
    };
    await customerSays('in-1', 'Can I book a table today?');
    expect(offeredTools()[0]).toEqual(['book_appointment', 'check_free_times']);
    expect(offered).toHaveLength(6);
    expect(offered[0]).toEqual({
      start: '2026-10-26T04:00:00.000Z',
      time: 'Monday 2026-10-26 12:00–13:00',
    });
    expect(sameTurnBooking).toContain('the customer has not replied');
    expect(fake().events).toEqual([]);
    expect(t.wa.sent[0]?.text).toContain('12:00');
    expect(toolEvents()).toEqual([
      {
        title: 'Check free times',
        sourceLabel: 'Google Calendar',
        calendar: { action: 'checked' },
      },
    ]);
    expect(activity()).toEqual(['checked']);
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM calendar_offers').get()).toEqual({ n: 6 });
    expect(events.map((e) => [e.tool, e.source, e.ok])).toEqual([
      ['check_free_times', 'google-calendar', true],
      ['book_appointment', 'google-calendar', true],
    ]);

    let booked = '';
    script = async (tools, signal) => {
      booked = await call(tools, 'book_appointment', { start: offered[1]!.start }, signal);
      return { reply: 'What is your email?', action: 'answer' };
    };
    // the name and number are known (WhatsApp), the email is not: nothing is booked, the AI asks
    await customerSays('in-2', 'The 1 pm one please');
    expect(booked).toBe(
      'Not booked yet: ask the customer for their email address, then call book_appointment again with the same "start" and what they wrote.',
    );
    expect(fake().events).toEqual([]);

    script = async (tools, signal) => {
      booked = await call(
        tools,
        'book_appointment',
        { start: offered[1]!.start, email: 'mei.ying@example.com' },
        signal,
      );
      return { reply: 'Booked for 1 pm.', action: 'answer' };
    };
    await customerSays('in-2b', 'Sure, it is Mei.Ying@example.com');
    expect(booked).toBe(
      'Booked: Monday 2026-10-26 13:00–14:00. Confirm this time to the customer.',
    );
    expect(fake().events).toEqual([
      {
        calendarId: BOOKINGS,
        id: expect.stringMatching(/^[0-9a-f]{64}$/),
        summary: 'Booking · Mei Ying',
        description:
          'Booked by the EzyChat AI\nName: Mei Ying\nPhone: +60123456789\nEmail: mei.ying@example.com',
        start: '2026-10-26T05:00:00.000Z',
        end: '2026-10-26T06:00:00.000Z',
        timeZone: 'Asia/Kuala_Lumpur',
      },
    ]);
    expect(toolEvents().at(-1)).toEqual({
      title: 'Book appointment',
      sourceLabel: 'Google Calendar',
      calendar: {
        action: 'booked',
        start: '2026-10-26T05:00:00.000Z',
        end: '2026-10-26T06:00:00.000Z',
      },
    });
    expect(activity()).toEqual(['checked', 'booked']);
    expect(
      t.ctx.db.prepare('SELECT agent_id, chat_jid, calendar_id FROM calendar_bookings').all(),
    ).toEqual([{ agent_id: agentId, chat_jid: jid, calendar_id: BOOKINGS }]);

    // the same time again: no second event
    script = async (tools, signal) => {
      booked = await call(
        tools,
        'book_appointment',
        { start: offered[1]!.start, email: 'mei.ying@example.com' },
        signal,
      );
      return { reply: 'Already booked.', action: 'answer' };
    };
    await customerSays('in-3', 'Did you book it?');
    expect(booked).toContain('Already booked');
    expect(fake().events).toHaveLength(1);

    // a retry after a lost answer: Google already has our event id, so it is checked, not doubled
    t.ctx.db.prepare('DELETE FROM calendar_bookings').run();
    await customerSays('in-4', 'Please confirm');
    expect(booked).toBe(
      'Booked: Monday 2026-10-26 13:00–14:00. Confirm this time to the customer.',
    );
    expect(fake().calls).toContain('getEvent');
    expect(fake().events).toHaveLength(1);
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM calendar_bookings').get()).toEqual({ n: 1 });
  });

  it('tells the AI which booking details to ask for, and refuses an email the customer never wrote', async () => {
    const actor = await setUp({ booking: { book: true } });
    t.ctx.services.ai!.saveMember({ displayName: 'Aina', enabled: true, instructions: '' }, actor);
    let checked: { bookingDetails?: object; note?: string; freeTimes: Array<{ start: string }> } = {
      freeTimes: [],
    };
    script = async (tools, signal) => {
      checked = JSON.parse(await call(tools, 'check_free_times', {}, signal)) as typeof checked;
      return { reply: 'Free at 12. Your email?', action: 'answer' };
    };
    await customerSays('in-1', 'Can I book a table today?');
    expect(checked.bookingDetails).toEqual({ name: 'saved', email: 'ask', phone: 'saved' });
    expect(checked.note).toContain('Booking also needs their email address');

    let booked = '';
    script = async (tools, signal) => {
      booked = await call(
        tools,
        'book_appointment',
        { start: checked.freeTimes[0]!.start, email: 'invented@example.com' },
        signal,
      );
      return { reply: 'One moment.', action: 'answer' };
    };
    await customerSays('in-2', '12 please');
    expect(booked).toContain('pass only the email address the customer wrote in this chat');
    expect(fake().events).toEqual([]);

    // with the email saved by the team, nothing is left to ask
    saveContact('mei@example.com');
    script = async (tools, signal) => {
      checked = JSON.parse(await call(tools, 'check_free_times', {}, signal)) as typeof checked;
      return { reply: 'Free at 12.', action: 'answer' };
    };
    await customerSays('in-3', 'Other times?');
    expect(checked.bookingDetails).toEqual({ name: 'saved', email: 'saved', phone: 'saved' });
    expect(checked.note).not.toContain('Booking also needs');
  });

  it('books a confirmed time when the AI checks free times again in the booking turn', async () => {
    const actor = await setUp({ booking: { book: true } });
    t.ctx.services.ai!.saveMember({ displayName: 'Aina', enabled: true, instructions: '' }, actor);
    let offered: Array<{ start: string; time: string }> = [];
    script = async (tools, signal) => {
      offered = freeTimes(await call(tools, 'check_free_times', {}, signal));
      return { reply: `Free: ${offered[0]!.time}`, action: 'answer' };
    };
    await customerSays('in-1', 'Can I book a table today?');
    saveContact('mei@example.com');

    // the re-check records the same times again, after the customer's answer
    let booked = '';
    script = async (tools, signal) => {
      await call(tools, 'check_free_times', {}, signal);
      booked = await call(tools, 'book_appointment', { start: offered[0]!.start }, signal);
      return { reply: 'Booked for 12.', action: 'answer' };
    };
    await customerSays('in-2', '12 please, book it');
    expect(booked).toBe(
      'Booked: Monday 2026-10-26 12:00–13:00. Confirm this time to the customer.',
    );
    expect(fake().events).toHaveLength(1);
  });

  it('refuses times that were not offered, became busy or break the rules, and garbage input', async () => {
    const actor = await setUp({ booking: { book: true }, context: true });
    t.ctx.services.ai!.saveMember({ displayName: 'Aina', enabled: true, instructions: '' }, actor);
    let offered: Array<{ start: string }> = [];
    script = async (tools, signal) => {
      offered = freeTimes(await call(tools, 'check_free_times', { date: '2026-10-27' }, signal));
      return { reply: 'Here are times.', action: 'answer' };
    };
    await customerSays('in-1', 'Tomorrow?');
    saveContact('mei@example.com');
    expect(offered[0]!.start).toBe('2026-10-27T02:00:00.000Z');
    const outputs: string[] = [];
    fake().busy = [{ start: offered[0]!.start, end: offered[1]!.start }];
    script = async (tools, signal) => {
      outputs.push(await call(tools, 'book_appointment', { start: offered[0]!.start }, signal));
      outputs.push(
        await call(tools, 'book_appointment', { start: '2026-10-27T02:30:00.000Z' }, signal),
      );
      outputs.push(await call(tools, 'book_appointment', { start: 'tomorrow at 10' }, signal));
      return { reply: 'Sorry, that time is gone.', action: 'answer' };
    };
    await customerSays('in-2', '10 am');
    expect(outputs[0]).toContain('that time was just taken');
    expect(outputs[1]).toContain('was not one of the free times offered');
    expect(outputs[2]).toContain('pass the "start" value');
    expect(fake().events).toEqual([]);

    // the admin narrows the hours after the offer: the offered time is no longer allowed
    await saveBooking({ book: true, from: '14:00' });
    script = async (tools, signal) => {
      outputs.push(await call(tools, 'book_appointment', { start: offered[1]!.start }, signal));
      return { reply: 'Let me check again.', action: 'answer' };
    };
    await customerSays('in-3', '11 then');
    expect(outputs[3]).toContain('the booking rules no longer allow');
    expect(fake().events).toEqual([]);
  });

  it('offers only free times when booking is off, and no tools when disconnected or expired', async () => {
    const actor = await setUp({ context: true });
    t.ctx.services.ai!.saveMember({ displayName: 'Aina', enabled: true, instructions: '' }, actor);
    script = async () => ({ reply: 'We open 10 to 6.', action: 'answer' });
    await customerSays('in-1', 'Hours?');
    expect(offeredTools()[0]).toEqual(['check_free_times']);

    fake().mode = 'expired';
    fake().expireAccessTokens();
    await t.ctx.services.googleCalendar!.refreshStatus();
    await customerSays('in-2', 'And Sunday?');
    expect(offeredTools()[1]).toEqual([]);

    fake().mode = 'ok';
    await t.ctx.services.googleCalendar!.disconnect(actor);
    await customerSays('in-3', 'Ok');
    expect(offeredTools()[2]).toEqual([]);
  });

  it('counts the calendar as facts only with Check free times on and a calendar chosen', async () => {
    await setUp({ booking: { checkFree: false } });
    expect(() =>
      t.ctx.services.ai!.saveMember(
        { displayName: 'Aina', enabled: true, instructions: '' },
        { userId: adminId, ip: null },
      ),
    ).toThrow('Add business context');
    await saveBooking({ calendarId: null });
    expect(() =>
      t.ctx.services.ai!.saveMember(
        { displayName: 'Aina', enabled: true, instructions: '' },
        { userId: adminId, ip: null },
      ),
    ).toThrow('Add business context');
  });

  it('hands the chat over with lookup_failed when Google fails, and says so in Activity', async () => {
    const actor = await setUp({ context: true });
    t.ctx.services.ai!.saveMember({ displayName: 'Aina', enabled: true, instructions: '' }, actor);
    fake().mode = 'unavailable';
    script = async (tools, signal) => {
      await call(tools, 'check_free_times', {}, signal).catch(() => {});
      signal.throwIfAborted();
      return { reply: 'Free at noon.', action: 'answer' };
    };
    const handoffs: unknown[] = [];
    t.ctx.bus.on('ai:handoff', (chat) => handoffs.push(chat));
    await customerSays('in-1', 'Free today?');
    expect(t.wa.sent[0]?.text).toBe(HANDOFF_REPLY);
    expect(handoffs).toHaveLength(1);
    const audit = t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'ai.handoff'")
      .get() as { meta: string };
    expect(JSON.parse(audit.meta).reason).toBe('lookup_failed');
    expect(activity()).toEqual(['failed']);
    expect(toolEvents()).toEqual([]);
    expect((await t.ctx.services.googleCalendar!.status()).state).toBe('unavailable');
  });

  it('adds a "handed over" line when the AI hands a chat over after offering times', async () => {
    const actor = await setUp({ context: true });
    t.ctx.services.ai!.saveMember({ displayName: 'Aina', enabled: true, instructions: '' }, actor);
    script = async (tools, signal) => {
      await call(tools, 'check_free_times', {}, signal);
      return { reply: 'Free at 12.', action: 'answer' };
    };
    await customerSays('in-1', 'Free today?');
    script = async () => ({
      reply: HANDOFF_REPLY,
      action: 'handoff',
      handoffReason: 'needs_action',
    });
    await customerSays('in-2', '12 please, book it');
    expect(activity()).toEqual(['checked', 'handed_over']);
    const list = t.ctx.services.googleCalendar!.activity();
    expect(list[0]).toMatchObject({
      kind: 'handed_over',
      agentId,
      agentName: 'Aina',
      customer: 'Mei Ying',
      chatJid: jid,
    });
  });
});

describe('Google Calendar in Try it', () => {
  it('reads free times but never books, and reports the booking as not run', async () => {
    await setUp({ booking: { book: true } });
    let offered: Array<{ start: string }> = [];
    let bookOutput = '';
    script = async (tools, signal) => {
      offered = freeTimes(await call(tools, 'check_free_times', {}, signal));
      bookOutput = await call(tools, 'book_appointment', { start: offered[0]!.start }, signal);
      return { reply: 'Booked for noon!', action: 'answer' };
    };
    const result: AiTryResult = await t.ctx.services.ai!.tryAnswer({
      question: 'Book me at noon',
      knowledge: { displayName: 'Aina', instructions: '' },
      agentId,
    });
    expect(result).toMatchObject({ ok: true, action: 'answer' });
    expect(bookOutput).toContain('Test only (Try it): nothing was booked');
    expect(result.lookups).toEqual([
      expect.objectContaining({
        tool: 'check_free_times',
        source: 'google-calendar',
        title: 'Check free times',
        sourceLabel: 'Google Calendar',
        calendar: { action: 'checked' },
        ok: true,
      }),
      expect.objectContaining({
        tool: 'book_appointment',
        title: 'Book appointment',
        calendar: {
          action: 'booked',
          start: '2026-10-26T04:00:00.000Z',
          end: '2026-10-26T05:00:00.000Z',
        },
        notRun: true,
        ok: true,
      }),
    ]);
    expect(result.lookups![0]).not.toHaveProperty('notRun');
    expect(fake().events).toEqual([]);
    expect(fake().calls).not.toContain('insertEvent');
    for (const table of [
      'calendar_offers',
      'calendar_bookings',
      'calendar_activity',
      'chat_events',
    ])
      expect(t.ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
  });

  it('answers from the calendar alone (no missing-facts hand-over) and hands over on a Google failure', async () => {
    await setUp();
    script = async (tools, signal) => {
      await call(tools, 'check_free_times', {}, signal).catch(() => {});
      signal.throwIfAborted();
      return { reply: 'Noon is free.', action: 'answer' };
    };
    const body = {
      question: 'Free today?',
      knowledge: { displayName: 'Aina', instructions: '' },
      agentId,
    };
    expect(await t.ctx.services.ai!.tryAnswer(body)).toMatchObject({
      ok: true,
      action: 'answer',
      reply: 'Noon is free.',
    });
    fake().mode = 'unavailable';
    expect(await t.ctx.services.ai!.tryAnswer(body)).toMatchObject({
      ok: true,
      action: 'handoff',
      handoffReason: 'lookup_failed',
      lookups: [expect.objectContaining({ tool: 'check_free_times', ok: false })],
    });
  });
});

describe('chat merge', () => {
  it('moves calendar offers, bookings and activity to the merged chat', async () => {
    await setUp({ connect: false });
    const lid = '123456789@lid';
    const chats = getChats(t.ctx);
    chats.upsertFromWa({ jid, type: 'dm', name: 'Mei Ying' });
    chats.upsertFromWa({ jid: lid, type: 'dm', name: 'Mei Ying' });
    const db = t.ctx.db;
    db.prepare(
      'INSERT INTO calendar_offers (agent_id, chat_jid, start_at, end_at, offered_at) VALUES (?, ?, 1, 2, 3)',
    ).run(agentId, jid);
    const book = db.prepare(
      "INSERT INTO calendar_bookings (agent_id, chat_jid, event_id, calendar_id, start_at, end_at, created_at) VALUES (?, ?, ?, 'cal', ?, 2, 3)",
    );
    book.run(agentId, jid, 'e1', 1);
    book.run(agentId, jid, 'e2', 5);
    book.run(agentId, lid, 'e3', 5); // the same time in both chats: one is kept
    db.prepare(
      "INSERT INTO calendar_activity (kind, agent_id, chat_jid, at) VALUES ('checked', ?, ?, 1)",
    ).run(agentId, jid);
    mergeChat(db, jid, lid, { now: 10 });
    const where = (table: string, chat: string) =>
      (
        db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE chat_jid = ?`).get(chat) as {
          n: number;
        }
      ).n;
    for (const table of ['calendar_offers', 'calendar_bookings', 'calendar_activity'])
      expect(where(table, jid), table).toBe(0);
    expect(where('calendar_offers', lid)).toBe(1);
    expect(where('calendar_bookings', lid)).toBe(2);
    expect(where('calendar_activity', lid)).toBe(1);
  });
});
