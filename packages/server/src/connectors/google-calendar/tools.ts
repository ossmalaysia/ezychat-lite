import { tool, type ToolSet } from 'ai';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AiToolCalendarDetail } from '@ezychat/shared';
import { agentById } from '../../ai/agents.js';
import type {
  AgentToolInfo,
  AgentToolsInput,
  ExtensionToolCall,
  ExtensionToolsTurn,
} from '../../ai/agent/extension-tools.js';
import type { AppContext } from '../../context.js';
import { getChats } from '../../wa-bridge/index.js';
import { GoogleError } from './google.js';
import { CONTACT_FIELDS, type ContactField } from './contact.js';
import type { BookResult } from './service.js';
import { parseDate, slotLabel } from './slots.js';

export const CHECK_FREE_TIMES = 'check_free_times';
export const BOOK_APPOINTMENT = 'book_appointment';
export const CALENDAR_TOOL_NAMES = [CHECK_FREE_TIMES, BOOK_APPOINTMENT] as const;
const SOURCE = 'google-calendar';
const SOURCE_LABEL = 'Google Calendar';
const CHECK_TITLE = 'Check free times';
const BOOK_TITLE = 'Book appointment';

/** True when this agent's calendar counts as a source of facts (connected and Check free times on). */
export function calendarLookupsAvailable(ctx: AppContext, agentId?: number | null): boolean {
  return !!ctx.services.googleCalendar?.usable(agentId);
}

const FIELD_WORDS: Record<ContactField, string> = {
  name: 'name',
  email: 'email address',
  phone: 'phone number',
};

/** What the tool tells the model when the server refused a booking. */
function refusal(result: Exclude<BookResult, { ok: true }>): string {
  if (result.reason === 'missing_details')
    return `Not booked yet: ask the customer for their ${result.missing.map((f) => FIELD_WORDS[f]).join(' and ')}, then call book_appointment again with the same "start" and what they wrote.`;
  if (result.reason === 'not_from_customer')
    return `Not booked: pass only the ${FIELD_WORDS[result.field]} the customer wrote in this chat, exactly as they wrote it, or leave it out to use the saved one.`;
  if (result.reason === 'invalid_email')
    return 'Not booked: that email address does not look valid. Ask the customer to check it.';
  return REFUSALS[result.reason];
}

const REFUSALS = {
  not_offered:
    'Not booked: that time was not one of the free times offered in this chat in the last 24 hours. Call check_free_times and offer times again.',
  no_reply_since:
    'Not booked: the customer has not replied since the times were offered. Wait for them to choose one time in their own words.',
  outside_rules:
    'Not booked: the booking rules no longer allow that time. Call check_free_times and offer other times.',
  busy: 'Not booked: that time was just taken. Call check_free_times and offer other times.',
} as const;

/**
 * The Google Calendar tools for one AI agent turn: `check_free_times` when the agent may check, and
 * `book_appointment` when it may also book. Try it (no chat) never books. A Google failure marks the
 * turn failed and calls `onFailure` (the caller hands over with `lookup_failed`).
 */
export function calendarAgentTools(
  ctx: AppContext,
  log: Logger,
  input: AgentToolsInput,
  options: { onFailure: () => void; onCall?: (name: string) => void },
): ExtensionToolsTurn {
  const service = ctx.services.googleCalendar;
  const settings = service?.usable(input.agentId);
  const calls: ExtensionToolCall[] = [];
  let failed = false;
  let checked = false;
  const tools: ToolSet = {};
  const empty = {
    tools,
    failed: () => false,
    used: () => [],
    calls: () => [],
    dispose: async () => {},
  };
  if (!service || !settings || input.agentId === undefined) return empty;
  const agentId = input.agentId;
  const chatJid = input.chatJid;
  const timeZone = service.timeZone();

  const run = async <T>(
    name: string,
    title: string,
    body: () => Promise<{ output: T; calendar?: AiToolCalendarDetail; notRun?: boolean }>,
  ): Promise<T> => {
    options.onCall?.(name);
    const started = Date.now();
    const finish = (ok: boolean, extra: { calendar?: AiToolCalendarDetail; notRun?: boolean }) => {
      const ms = Date.now() - started;
      calls.push({
        tool: name,
        source: SOURCE,
        title,
        sourceLabel: SOURCE_LABEL,
        ok,
        ms,
        ...extra,
      });
      log.info({ event: 'ai_tool_call', tool: name, source: SOURCE, ok, ms }, 'AI tool call');
      ctx.bus.emit('ai:tool_call', {
        agent: input.agent,
        agentId,
        chatJid,
        tool: name,
        source: SOURCE,
        title,
        ok,
        ms,
      });
    };
    try {
      const { output, calendar, notRun } = await body();
      finish(true, { ...(calendar ? { calendar } : {}), ...(notRun ? { notRun } : {}) });
      return output;
    } catch (error) {
      // A cancelled turn is not a failed look-up.
      if (input.signal.aborted) throw error;
      failed = true;
      log.warn(
        {
          event: 'google_calendar_tool_failed',
          tool: name,
          kind: error instanceof GoogleError ? error.kind : 'other',
          status: error instanceof GoogleError ? error.status : null,
        },
        'Google Calendar tool failed',
      );
      if (chatJid) service.addActivity({ kind: 'failed', agentId, chatJid });
      finish(false, {});
      options.onFailure();
      throw error;
    }
  };

  tools[CHECK_FREE_TIMES] = tool({
    description:
      "Check the business's Google Calendar for free appointment times within its booking rules " +
      `(times are in ${timeZone}). Call it when the customer wants to book or asks when a time is free. ` +
      'Offer the customer only times this tool returned, never other times. With no date it returns the ' +
      'next free times; pass a date (YYYY-MM-DD) when the customer names a day.',
    inputSchema: z.object({
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('A day the customer asked about, YYYY-MM-DD in the business time zone'),
    }),
    execute: ({ date }) =>
      run(CHECK_FREE_TIMES, CHECK_TITLE, async () => {
        const current = service.usable(agentId);
        if (!current)
          return { output: 'Free times are not available now. Hand the chat to the team.' };
        const day = date ? parseDate(date) : null;
        const slots = await service.freeTimes(current, day, input.signal);
        if (chatJid && slots.length) service.recordOffers(agentId, chatJid, slots);
        if (chatJid && !checked) service.addActivity({ kind: 'checked', agentId, chatJid });
        checked = true;
        // Booking needs a name, email and phone: say which are saved, so the AI asks only for the rest.
        const saved = current.book && chatJid ? service.savedContact(chatJid) : null;
        const ask = saved ? CONTACT_FIELDS.filter((field) => !saved[field]) : [];
        return {
          output: JSON.stringify({
            timeZone,
            lengthMinutes: current.lengthMin,
            freeTimes: slots.map((slot) => ({
              start: new Date(slot.start).toISOString(),
              time: slotLabel(slot, timeZone),
            })),
            ...(saved
              ? {
                  bookingDetails: Object.fromEntries(
                    CONTACT_FIELDS.map((field) => [field, saved[field] ? 'saved' : 'ask']),
                  ),
                }
              : {}),
            note: slots.length
              ? 'Offer only these times. To book, the customer must choose one of them in their own words.' +
                (ask.length
                  ? ` Booking also needs their ${ask.map((f) => FIELD_WORDS[f]).join(' and ')}: ask for it together with the time choice.`
                  : '')
              : 'No free times match. Ask about another day, or hand the chat to the team.',
          }),
          calendar: { action: 'checked' },
        };
      }),
  });

  if (settings.book)
    tools[BOOK_APPOINTMENT] = tool({
      description:
        "Add the customer's appointment to the business's Google Calendar. When this tool is offered, " +
        'booking through it is allowed and is the only way you may book. Book only the exact time the ' +
        'customer chose from the times check_free_times returned in this chat, after they confirmed it in ' +
        'their own words; pass that time\'s "start" value unchanged. Never guess a time. A booking needs ' +
        "the customer's name, email and phone: leave a field out to use the saved contact, or pass exactly " +
        'what the customer wrote in this chat; never invent one. You cannot cancel or move a booking: for ' +
        'that, hand the chat to the team. Tell the customer it is booked only when this tool says so.',
      inputSchema: z.object({
        start: z.string().min(1).max(40).describe('The "start" value of the chosen free time'),
        name: z
          .string()
          .max(100)
          .optional()
          .describe("The customer's name, only as they wrote it in this chat"),
        email: z
          .string()
          .max(254)
          .optional()
          .describe("The customer's email address, only as they wrote it in this chat"),
        phone: z
          .string()
          .max(32)
          .optional()
          .describe('A phone number the customer wrote in this chat (else their WhatsApp number)'),
      }),
      execute: ({ start, name, email, phone }) =>
        run(BOOK_APPOINTMENT, BOOK_TITLE, async () => {
          const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(start) ? Date.parse(start) : Number.NaN;
          if (!Number.isFinite(at))
            return {
              output: 'Not booked: pass the "start" value of a time check_free_times returned.',
            };
          const end = new Date(at + settings.lengthMin * 60_000).toISOString();
          const iso = new Date(at).toISOString();
          if (!chatJid)
            return {
              output:
                'Test only (Try it): nothing was booked. In a real chat this time would be booked now; ' +
                'answer as you would after a successful booking.',
              calendar: { action: 'booked', start: iso, end },
              notRun: true,
            };
          const result = await service.book(
            agentId,
            chatJid,
            at,
            { name, email, phone },
            input.signal,
          );
          if (!result.ok) return { output: refusal(result) };
          const detail: AiToolCalendarDetail = {
            action: 'booked',
            start: new Date(result.start).toISOString(),
            end: new Date(result.end).toISOString(),
          };
          if (!result.already) {
            // The chat line is written at once: the event exists even if this reply never goes out.
            const agent = agentById(ctx.db, agentId);
            if (agent)
              getChats(ctx).addAiToolUsed(chatJid, agent.userId, [
                { title: BOOK_TITLE, sourceLabel: SOURCE_LABEL, calendar: detail },
              ]);
          }
          return {
            output: `${result.already ? 'Already booked' : 'Booked'}: ${slotLabel(result, timeZone)}. Confirm this time to the customer.`,
            calendar: detail,
          };
        }),
    });

  return {
    tools,
    failed: () => failed,
    used: (): AgentToolInfo[] =>
      chatJid && calls.some((call) => call.ok && call.calendar?.action === 'checked')
        ? [{ title: CHECK_TITLE, sourceLabel: SOURCE_LABEL, calendar: { action: 'checked' } }]
        : [],
    calls: () => [...calls],
    dispose: async () => {},
  };
}
