/**
 * Declared guards (design: connector-list, Guards): the checks the core runs before it calls a
 * partner's tool. A list entry can only add checks; the core rules (write tools start off, Try it
 * never runs them, nothing is undone) live in tools.ts. These are the general form of the checks
 * the Google Calendar connector has in code (offered times, customer replied, booking details,
 * booking hours).
 */
import type { ConnectorSetting, ConnectorTool } from '@ezychat/shared';
import type { DB } from '../../db/index.js';
import { customerWrote } from '../google-calendar/contact.js';
import { customerRepliedSince } from '../google-calendar/repo.js';
import { countCalls, hasValue, lastAiReplyAt, type ActivityReason } from './repo.js';

export type GuardResult = { ok: true } | { ok: false; reason: ActivityReason; arg?: string };

export interface GuardInput {
  db: DB;
  connectorId: string;
  tool: ConnectorTool;
  args: Record<string, unknown>;
  chatJid: string;
  /** The AI agent's user (its replies in the chat). */
  aiUserId: number;
  /** The agent's settings with the entry's defaults filled in. */
  settings: Record<string, unknown>;
  settingDefs: readonly ConnectorSetting[];
  timeZone: string;
  now: number;
  /** The customer's own messages in this chat (text and transcripts). */
  customerTexts: () => readonly string[];
  /** The saved contact's name, email and phone numbers. */
  savedContact: () => readonly string[];
}

/** The value at `a.b.c` of the arguments, or undefined. */
export function argAt(args: unknown, path: string): unknown {
  let value: unknown = args;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

const asText = (value: unknown): string | null =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : null;

const PHONE = /^\+?[\d\s().-]{7,}$/;
const digits = (text: string) => text.replace(/\D/g, '');

/** True when the customer gave `value`: in their own messages, or it is the saved contact's. */
export function customerGave(
  value: string,
  texts: () => readonly string[],
  saved: () => readonly string[],
): boolean {
  if (!value) return false;
  const phone = PHONE.test(value) && digits(value).length >= 7;
  const fromSaved = saved().some((known) =>
    phone
      ? digits(known).length >= 7 && digits(known) === digits(value)
      : known.trim().toLowerCase() === value.toLowerCase(),
  );
  return fromSaved || customerWrote(texts(), phone ? 'phone' : 'name', value);
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Weekday (0 = Sunday) and "HH:MM" of an instant in `timeZone`. */
export function localTime(at: number, timeZone: string): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: WEEKDAYS[part('weekday')] ?? -1, time: `${part('hour')}:${part('minute')}` };
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True when the ISO time `value` fits the setting (a timeRange or days value). */
export function fitsSetting(
  value: unknown,
  def: ConnectorSetting | undefined,
  setting: unknown,
  timeZone: string,
): boolean {
  if (typeof value !== 'string' || !ISO_TIME.test(value) || !def) return false;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return false;
  const local = localTime(at, timeZone);
  if (def.type === 'days')
    return Array.isArray(setting) && setting.some((day) => day === local.day);
  if (def.type === 'timeRange') {
    if (!Array.isArray(setting) || setting.length !== 2) return false;
    const [from, to] = setting as unknown[];
    if (typeof from !== 'string' || typeof to !== 'string' || !HHMM.test(from) || !HHMM.test(to))
      return false;
    return local.time >= from && local.time < to;
  }
  return false;
}

/**
 * Runs the tool's declared guards in a live chat, cheapest first: limits, confirmFirst,
 * valueFrom, fromCustomer, within. The first that fails decides the refusal.
 */
export function checkGuards(input: GuardInput): GuardResult {
  const guards = input.tool.guards;
  if (!guards) return { ok: true };
  const { db, connectorId, chatJid, now } = input;
  const name = input.tool.name;

  const limits = guards.limits;
  if (
    limits?.perChat !== undefined &&
    countCalls(db, connectorId, name, chatJid, now) >= limits.perChat
  )
    return { ok: false, reason: 'limit' };
  if (limits?.perDay !== undefined && countCalls(db, connectorId, name, null, now) >= limits.perDay)
    return { ok: false, reason: 'limit' };

  if (guards.confirmFirst) {
    // The customer must have written after the AI's last reply (the proposal) that came before
    // this turn; with no reply yet there was nothing to confirm.
    const proposal = lastAiReplyAt(db, chatJid, input.aiUserId);
    if (proposal === null || !customerRepliedSince(db, chatJid, proposal))
      return { ok: false, reason: 'confirm_first' };
  }

  for (const [path, from] of Object.entries(guards.valueFrom ?? {})) {
    const value = argAt(input.args, path);
    if (value === undefined || value === null) continue;
    const text = asText(value);
    if (text === null || !hasValue(db, connectorId, chatJid, from, text, now))
      return { ok: false, reason: 'value_from', arg: path };
  }

  for (const path of guards.fromCustomer ?? []) {
    const value = argAt(input.args, path);
    if (value === undefined || value === null || value === '') continue;
    const text = asText(value);
    if (text === null || !customerGave(text, input.customerTexts, input.savedContact))
      return { ok: false, reason: 'from_customer', arg: path };
  }

  for (const [path, settingId] of Object.entries(guards.within ?? {})) {
    const def = input.settingDefs.find((s) => s.id === settingId);
    if (!fitsSetting(argAt(input.args, path), def, input.settings[settingId], input.timeZone))
      return { ok: false, reason: 'within', arg: path };
  }
  return { ok: true };
}

/** What the tool tells the model when a guard refused the call (fixed text, no values). */
export function refusalText(
  result: Extract<GuardResult, { ok: false }>,
  tool: ConnectorTool,
  toolName: (partnerTool: string) => string,
): string {
  const arg = result.arg ?? '';
  switch (result.reason) {
    case 'limit':
      return 'Not done: the limit for this action was reached. Do not try again; hand the chat to the team if the customer needs more.';
    case 'confirm_first':
      return 'Not done: the customer has not confirmed. Tell the customer exactly what you will do and wait for them to confirm in their own words, then call this tool again.';
    case 'value_from': {
      const from = tool.guards?.valueFrom?.[arg] ?? '';
      return `Not done: "${arg}" must be a value that ${toolName(from)} returned in this chat in the last 24 hours. Call ${toolName(from)} first and use one of its values unchanged.`;
    }
    case 'from_customer':
      return `Not done: pass only the "${arg}" the customer wrote in this chat, exactly as they wrote it. Ask the customer for it; never invent it.`;
    case 'within':
      return `Not done: "${arg}" is outside what this business allows. Offer the customer another time within the allowed hours and days.`;
    default:
      return 'Not done. Hand the chat to the team.';
  }
}
