/**
 * Google Calendar connector (core; design docs/features/google-calendar/design.md). One Google
 * account per install: tokens only in an encrypted setting, refreshed before expiry. Per AI agent
 * booking settings; the AI tools (tools.ts) read free times and, when allowed, book.
 *
 * Logs carry counts, ids and states only: never tokens, codes, URLs with codes, event text, names
 * or phone numbers.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  BookingSettings,
  type CalendarActivity,
  type Chat,
  type GoogleCalendarConnectProgress,
  type GoogleCalendarConnectStart,
  type GoogleCalendarItem,
  type GoogleCalendarStatus,
} from '@ezychat/shared';
import { agentById } from '../../ai/agents.js';
import { AI_TIMEZONE_SETTING, resolveAiTimeZone } from '../../ai/prompt.js';
import { createPkce } from '../../ai/chatgpt-oauth.js';
import type { AppContext } from '../../context.js';
import { audit } from '../../db/audit.js';
import { HttpError, errors } from '../../http/errors.js';
import { getChats } from '../../wa-bridge/index.js';
import { FAKE_GOOGLE_APP, FAKE_GOOGLE_ENDPOINTS, FakeGoogle } from './fake.js';
import {
  GOOGLE_ENDPOINTS,
  GOOGLE_SCOPES,
  GoogleClient,
  GoogleError,
  REQUIRED_SCOPES,
  type GoogleCalendarEntry,
  type GoogleTokens,
} from './google.js';
import {
  addActivity,
  bookedSince,
  customerRepliedSince,
  findOffer,
  handedOverSince,
  hasBooking,
  insertBooking,
  lastOffer,
  listActivity,
  readSettings,
  recordOffers,
  writeSettings,
} from './repo.js';
import {
  bookingWindow,
  freeSlots,
  isBusy,
  withinRules,
  type Interval,
  type LocalDate,
} from './slots.js';

declare module '../../context.js' {
  interface Services {
    googleCalendar?: GoogleCalendarService;
  }
}

export const TOKENS_SETTING = 'google_calendar_tokens';
export const PROBLEM_SETTING = 'google_calendar_problem';
export const CONNECT_TTL_MS = 10 * 60_000;
const MAX_PENDING = 20;
const CALENDARS_TTL_MS = 5 * 60_000;
/** Refresh this long before the access token runs out. */
const REFRESH_EARLY_MS = 60_000;

interface StoredTokens extends GoogleTokens {
  connectedAt: number;
}

interface Problem {
  state: 'expired' | 'unavailable';
  since: number;
}

interface Pending {
  requestId: string;
  verifier: string;
  challenge: string;
  redirectUri: string;
  createdAt: number;
  userId: number;
  ip: string | null;
  status: GoogleCalendarConnectProgress['status'];
  error: GoogleCalendarConnectProgress['error'];
  used: boolean;
}

export interface CallbackPage {
  status: number;
  title: string;
  message: string;
}

export type BookResult =
  | { ok: true; start: number; end: number; already: boolean }
  | { ok: false; reason: 'not_offered' | 'no_reply_since' | 'outside_rules' | 'busy' };

const WRITABLE = new Set(['owner', 'writer']);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export function toItem(entry: GoogleCalendarEntry): GoogleCalendarItem {
  return {
    id: entry.id,
    name: entry.name,
    primary: entry.primary,
    readOnly: !WRITABLE.has(entry.accessRole),
  };
}

export interface GoogleCalendarServiceOptions {
  /** Overrides the client (tests); default from the build's Google app, or the fake with --fake-wa. */
  client?: GoogleClient | null;
  fake?: FakeGoogle | null;
  now?: () => number;
}

export function createGoogleCalendarService(
  ctx: AppContext,
  options: GoogleCalendarServiceOptions = {},
) {
  const log = ctx.log.child({ mod: 'google-calendar' });
  const now = options.now ?? Date.now;
  // The fake replaces Google only with --fake-wa (never in service mode: parseArgs refuses it).
  const fake =
    options.fake !== undefined
      ? options.fake
      : ctx.config.fakeWa && ctx.config.mode !== 'service'
        ? new FakeGoogle()
        : null;
  const client: GoogleClient | null =
    options.client !== undefined
      ? options.client
      : fake
        ? new GoogleClient(FAKE_GOOGLE_APP, FAKE_GOOGLE_ENDPOINTS, fake.fetch)
        : ctx.config.googleOAuth
          ? new GoogleClient(ctx.config.googleOAuth, GOOGLE_ENDPOINTS)
          : null;

  const pending = new Map<string, Pending>(); // by state hash
  const byRequest = new Map<string, string>(); // requestId → state hash
  let calendars: { at: number; list: GoogleCalendarEntry[] } | null = null;
  let refreshing: Promise<StoredTokens> | null = null;

  const loadTokens = (): StoredTokens | null => {
    const raw = ctx.settings.getSecret(TOKENS_SETTING);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as StoredTokens;
      return value.accessToken && value.refreshToken ? value : null;
    } catch {
      return null;
    }
  };
  const saveTokens = (tokens: StoredTokens | null) =>
    ctx.settings.setSecret(TOKENS_SETTING, tokens ? JSON.stringify(tokens) : null);
  const problem = (): Problem | null => ctx.settings.get<Problem | null>(PROBLEM_SETTING, null);

  function markProblem(error: unknown) {
    if (!(error instanceof GoogleError) || error.kind === 'rejected') return;
    const current = problem();
    if (error.kind === 'unavailable' && current?.state === 'expired') return;
    const since = current?.state === error.kind ? current.since : now();
    if (current?.state !== error.kind) {
      log.warn(
        { event: 'google_calendar_problem', state: error.kind, status: error.status },
        'Google Calendar problem',
      );
      ctx.settings.set(PROBLEM_SETTING, { state: error.kind, since });
    }
  }
  function clearProblem() {
    if (problem()) {
      ctx.settings.set(PROBLEM_SETTING, null);
      log.info(
        { event: 'google_calendar_problem', state: 'connected' },
        'Google Calendar works again',
      );
    }
  }

  async function refreshNow(tokens: StoredTokens): Promise<StoredTokens> {
    if (!refreshing)
      refreshing = (async () => {
        try {
          const fresh = await client!.refresh(tokens.refreshToken);
          const next: StoredTokens = {
            ...fresh,
            account: fresh.account ?? tokens.account,
            scope: fresh.scope.length ? fresh.scope : tokens.scope,
            connectedAt: tokens.connectedAt,
          };
          // A disconnect while refreshing wins.
          if (loadTokens()) saveTokens(next);
          return next;
        } finally {
          refreshing = null;
        }
      })();
    return refreshing;
  }

  /** Runs one Google call with a valid access token; records problems and recoveries. */
  async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
    if (!client) throw new GoogleError('rejected');
    let tokens = loadTokens();
    if (!tokens) throw new GoogleError('rejected');
    try {
      let refreshed = false;
      if (tokens.expiresAt - REFRESH_EARLY_MS <= now()) {
        tokens = await refreshNow(tokens);
        refreshed = true;
      }
      let result: T;
      try {
        result = await fn(tokens.accessToken);
      } catch (error) {
        // An access token Google no longer accepts: refresh once and try again.
        if (refreshed || !(error instanceof GoogleError) || error.status !== 401) throw error;
        tokens = await refreshNow(tokens);
        result = await fn(tokens.accessToken);
      }
      clearProblem();
      return result;
    } catch (error) {
      markProblem(error);
      throw error;
    }
  }

  async function loadCalendars(force = false): Promise<GoogleCalendarEntry[]> {
    if (!force && calendars && now() - calendars.at < CALENDARS_TTL_MS) return calendars.list;
    const list = await withToken((token) => client!.calendarList(token));
    calendars = { at: now(), list };
    return list;
  }

  const configured = () => client !== null;

  function state(): GoogleCalendarStatus['state'] {
    if (!configured()) return 'not_configured';
    if (!loadTokens()) return 'disconnected';
    return problem()?.state ?? 'connected';
  }

  function prune() {
    const at = now();
    for (const [hash, entry] of pending)
      if (at - entry.createdAt > CONNECT_TTL_MS) {
        pending.delete(hash);
        byRequest.delete(entry.requestId);
      }
  }

  function timeZone(): string {
    return resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null));
  }

  /** The agent's settings when its calendar tools may be offered now, else null. */
  function usable(agentId: number | undefined | null): BookingSettings | null {
    if (agentId === undefined || agentId === null) return null;
    const current = state();
    if (current !== 'connected' && current !== 'unavailable') return null;
    if (!agentById(ctx.db, agentId)) return null;
    const settings = readSettings(ctx.db, agentId);
    return settings.checkFree && settings.calendarId ? settings : null;
  }

  async function busyTimes(
    settings: BookingSettings,
    from: number,
    to: number,
    signal?: AbortSignal,
  ): Promise<Interval[]> {
    const gap = settings.gapMin * 60_000;
    return withToken((token) =>
      client!.freeBusy(token, settings.calendarId!, from - gap, to + gap, signal),
    );
  }

  const onHandoff = (chat: Chat) => {
    try {
      const offer = lastOffer(ctx.db, chat.jid, now());
      if (!offer) return;
      if (bookedSince(ctx.db, chat.jid, offer.offeredAt)) return;
      if (handedOverSince(ctx.db, chat.jid, offer.offeredAt)) return;
      addActivity(
        ctx.db,
        { kind: 'handed_over', agentId: offer.agentId, chatJid: chat.jid },
        now(),
      );
    } catch (error) {
      log.warn(
        { event: 'google_calendar_handoff_failed', errName: (error as Error)?.name },
        'Calendar hand-over line failed',
      );
    }
  };
  ctx.bus.on('ai:handoff', onHandoff);

  const service = {
    fake,
    configured,
    timeZone,
    usable,

    async status(): Promise<GoogleCalendarStatus> {
      const tokens = configured() ? loadTokens() : null;
      let list: GoogleCalendarEntry[] = [];
      if (tokens && problem()?.state !== 'expired') {
        try {
          list = await loadCalendars();
        } catch {
          list = calendars?.list ?? [];
        }
      }
      const current = state();
      return {
        state: current,
        account: tokens?.account ?? null,
        calendars: current === 'not_configured' || !tokens ? [] : list.map((c) => toItem(c)),
        connectedAt: tokens?.connectedAt ?? null,
        problemSince:
          current === 'expired' || current === 'unavailable' ? (problem()?.since ?? null) : null,
      };
    },

    /** Starts a sign-in: Google (or, with --fake-wa, the local consent page) opens in a new window. */
    startConnect(
      redirectUri: string,
      actor: { userId: number; ip: string | null },
    ): GoogleCalendarConnectStart {
      if (!client)
        throw new HttpError(409, 'not_configured', 'Google sign-in is not set up in this build');
      prune();
      while (pending.size >= MAX_PENDING) {
        const oldest = pending.keys().next().value!;
        byRequest.delete(pending.get(oldest)!.requestId);
        pending.delete(oldest);
      }
      const state = randomBytes(24).toString('base64url');
      const { verifier, challenge } = createPkce();
      const requestId = randomBytes(12).toString('hex');
      const hash = sha(state);
      pending.set(hash, {
        requestId,
        verifier,
        challenge,
        redirectUri,
        createdAt: now(),
        userId: actor.userId,
        ip: actor.ip,
        status: 'pending',
        error: null,
        used: false,
      });
      byRequest.set(requestId, hash);
      let authorizationUrl: string;
      if (fake) {
        const url = new URL('/api/dev/fake-google/consent', redirectUri);
        url.searchParams.set('state', state);
        url.searchParams.set('code_challenge', challenge);
        authorizationUrl = url.toString();
      } else authorizationUrl = client.authorizationUrl({ redirectUri, state, challenge });
      log.info({ event: 'google_calendar_connect_start' }, 'Google sign-in started');
      return { requestId, authorizationUrl };
    },

    progress(requestId: string): GoogleCalendarConnectProgress | null {
      const hash = byRequest.get(requestId);
      const entry = hash ? pending.get(hash) : undefined;
      if (!entry) return null;
      if (entry.status === 'pending' && now() - entry.createdAt > CONNECT_TTL_MS)
        return { status: 'failed', error: 'expired' };
      return { status: entry.status, error: entry.error };
    },

    /** The redirect from Google: one-time `state`, PKCE verifier, code exchange, tokens saved. */
    async callback(query: Record<string, unknown>): Promise<CallbackPage> {
      const expiredPage: CallbackPage = {
        status: 400,
        title: 'Sign-in link expired',
        message: 'Start the Google sign-in again from EzyChat.',
      };
      const stateParam = typeof query.state === 'string' ? query.state : '';
      const entry = stateParam ? pending.get(sha(stateParam)) : undefined;
      // A forged, reused or stale callback never changes the real sign-in.
      if (!entry || entry.used) return expiredPage;
      if (now() - entry.createdAt > CONNECT_TTL_MS) {
        entry.used = true;
        entry.status = 'failed';
        entry.error = 'expired';
        return expiredPage;
      }
      entry.used = true;
      const fail = (error: 'denied' | 'error', title: string): CallbackPage => {
        entry.status = 'failed';
        entry.error = error;
        log.info(
          { event: 'google_calendar_connect_failed', reason: error },
          'Google sign-in failed',
        );
        return {
          status: 400,
          title,
          message: 'You can close this window and try again from EzyChat.',
        };
      };
      if (typeof query.error === 'string' && query.error)
        return fail(query.error === 'access_denied' ? 'denied' : 'error', 'Sign-in cancelled');
      const code = typeof query.code === 'string' ? query.code : '';
      if (!code || code.length > 2048) return fail('error', 'Sign-in failed');
      let tokens: GoogleTokens;
      try {
        tokens = await client!.exchangeCode(code, entry.verifier, entry.redirectUri);
      } catch (error) {
        log.warn(
          {
            event: 'google_calendar_exchange_failed',
            status: (error as GoogleError)?.status ?? null,
          },
          'Google sign-in exchange failed',
        );
        return fail('error', 'Sign-in failed');
      }
      if (!REQUIRED_SCOPES.every((scope) => tokens.scope.includes(scope))) {
        await client!.revoke(tokens.refreshToken);
        return fail('error', 'Calendar access was not allowed');
      }
      saveTokens({ ...tokens, connectedAt: now() });
      ctx.settings.set(PROBLEM_SETTING, null);
      calendars = null;
      entry.status = 'done';
      audit(ctx.db, {
        userId: entry.userId,
        action: 'google_calendar.connect',
        ip: entry.ip,
        meta: { scopes: tokens.scope.length },
      });
      log.info(
        { event: 'google_calendar_connected', scopes: tokens.scope.length },
        'Google Calendar connected',
      );
      return {
        status: 200,
        title: 'Google Calendar connected',
        message: 'You can close this window and return to EzyChat.',
      };
    },

    /** Fake consent page (--fake-wa only): where Allow / Cancel lead, always our own callback. */
    fakeConsent(stateParam: string, allow: boolean): string | null {
      if (!fake) return null;
      const entry = pending.get(sha(stateParam));
      if (!entry || entry.used) return null;
      const url = new URL(entry.redirectUri);
      url.searchParams.set('state', stateParam);
      if (allow)
        url.searchParams.set('code', fake.issueCode(entry.challenge, GOOGLE_SCOPES.join(' ')));
      else url.searchParams.set('error', 'access_denied');
      return url.toString();
    },

    async disconnect(actor: { userId: number; ip: string | null }): Promise<void> {
      const tokens = loadTokens();
      saveTokens(null);
      ctx.settings.set(PROBLEM_SETTING, null);
      calendars = null;
      if (tokens && client) await client.revoke(tokens.refreshToken);
      audit(ctx.db, { userId: actor.userId, action: 'google_calendar.disconnect', ip: actor.ip });
      log.info({ event: 'google_calendar_disconnected' }, 'Google Calendar disconnected');
    },

    getSettings(agentId: number): BookingSettings {
      if (!agentById(ctx.db, agentId)) throw errors.notFound('Agent');
      return readSettings(ctx.db, agentId);
    },

    async putSettings(
      agentId: number,
      next: BookingSettings,
      actor: { userId: number; ip: string | null },
    ): Promise<BookingSettings> {
      if (!agentById(ctx.db, agentId)) throw errors.notFound('Agent');
      const parsed = BookingSettings.parse(next);
      const current = state();
      if (parsed.calendarId && (current === 'connected' || current === 'unavailable')) {
        let list: GoogleCalendarEntry[];
        try {
          list = await loadCalendars(true);
        } catch {
          throw new HttpError(503, 'google_unavailable', 'Google Calendar could not be reached');
        }
        const chosen = list.find((c) => c.id === parsed.calendarId);
        if (!chosen || !WRITABLE.has(chosen.accessRole))
          throw errors.validation('Choose a calendar you can add events to');
      }
      const before = readSettings(ctx.db, agentId);
      const fields = (Object.keys(parsed) as Array<keyof BookingSettings>).filter(
        (key) => JSON.stringify(before[key]) !== JSON.stringify(parsed[key]),
      );
      writeSettings(ctx.db, agentId, parsed, now());
      if (fields.length)
        audit(ctx.db, {
          userId: actor.userId,
          action: 'google_calendar.agent_settings',
          ip: actor.ip,
          meta: { agentId, fields },
        });
      return parsed;
    },

    activity(): CalendarActivity[] {
      return listActivity(ctx.db);
    },

    /** Re-reads the account (dev route: after the fake's state changed). */
    async refreshStatus(): Promise<GoogleCalendarStatus> {
      if (loadTokens()) await loadCalendars(true).catch(() => undefined);
      return service.status();
    },

    /** Free times within the agent's rules, minus Google's busy times. */
    async freeTimes(
      settings: BookingSettings,
      date: LocalDate | null,
      signal?: AbortSignal,
    ): Promise<Interval[]> {
      const at = now();
      const window = bookingWindow(settings, at);
      const busy = await busyTimes(
        settings,
        window.start,
        window.end + settings.lengthMin * 60_000,
        signal,
      );
      return freeSlots({ rules: settings, timeZone: timeZone(), now: at, busy, date });
    },

    recordOffers(agentId: number, chatJid: string, slots: readonly Interval[]) {
      recordOffers(ctx.db, agentId, chatJid, slots, now());
    },

    addActivity(row: Parameters<typeof addActivity>[1]) {
      addActivity(ctx.db, row, now());
    },

    /**
     * Books `start` for this chat. Guards: it was offered in this chat in the last 24 h, the
     * customer wrote after that offer, the rules still allow it, Google still shows it free, and the
     * same chat and time is never booked twice. Google errors are thrown (the tool hands over).
     */
    async book(
      agentId: number,
      chatJid: string,
      start: number,
      signal?: AbortSignal,
    ): Promise<BookResult> {
      const settings = usable(agentId);
      if (!settings?.book) return { ok: false, reason: 'outside_rules' };
      const at = now();
      const offer = findOffer(ctx.db, agentId, chatJid, start, at);
      if (!offer) return { ok: false, reason: 'not_offered' };
      const slot = { start: offer.start, end: offer.start + settings.lengthMin * 60_000 };
      if (hasBooking(ctx.db, chatJid, slot.start)) return { ok: true, ...slot, already: true };
      if (!customerRepliedSince(ctx.db, chatJid, offer.offeredAt))
        return { ok: false, reason: 'no_reply_since' };
      if (!withinRules(slot, settings, timeZone(), at))
        return { ok: false, reason: 'outside_rules' };
      const busy = await busyTimes(settings, slot.start, slot.end, signal);
      if (isBusy(slot, busy, settings.gapMin)) return { ok: false, reason: 'busy' };
      const chat = getChats(ctx).get(chatJid);
      const name = chat?.name?.trim() || 'Customer';
      const phone =
        chat?.phone ?? (chat?.waJid.endsWith('@s.whatsapp.net') ? chat.waJid.split('@')[0]! : null);
      const eventId = sha(`${agentId}|${chatJid}|${slot.start}`);
      const calendarId = settings.calendarId!;
      const zone = timeZone();
      const created = await withToken((token) =>
        client!.insertEvent(
          token,
          calendarId,
          {
            id: eventId,
            summary: `${settings.title} · ${name}`.slice(0, 200),
            description: ['Booked by the EzyChat AI', phone ? `WhatsApp: +${phone}` : null]
              .filter(Boolean)
              .join('\n'),
            start: slot.start,
            end: slot.end,
            timeZone: zone,
          },
          signal,
        ),
      );
      if (!created) {
        // Our own id exists already (a retry): confirm it is still there.
        const status = await withToken((token) =>
          client!.eventStatus(token, calendarId, eventId, signal),
        );
        if (status === null || status === 'cancelled') return { ok: false, reason: 'busy' };
      }
      insertBooking(ctx.db, { agentId, chatJid, eventId, calendarId, ...slot }, now());
      addActivity(ctx.db, { kind: 'booked', agentId, chatJid, ...slot }, now());
      log.info({ event: 'google_calendar_booked', agentId, created }, 'AI booked a calendar event');
      return { ok: true, ...slot, already: false };
    },

    shutdown() {
      ctx.bus.off('ai:handoff', onHandoff);
      pending.clear();
      byRequest.clear();
    },
  };
  return service;
}

export type GoogleCalendarService = ReturnType<typeof createGoogleCalendarService>;

export function initGoogleCalendar(ctx: AppContext) {
  ctx.services.googleCalendar = createGoogleCalendarService(ctx);
}

export function getGoogleCalendar(ctx: AppContext): GoogleCalendarService {
  const service = ctx.services.googleCalendar;
  if (!service) throw new Error('Google Calendar service not initialised');
  return service;
}
