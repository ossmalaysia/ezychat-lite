/**
 * Google Sheets connector (core; design docs/features/google-sheets/design.md). One Google account
 * per install (its own sign-in, separate from Google Calendar). Per AI agent: one spreadsheet, a
 * tab it may look things up in and a tab it may add new leads to (off until an admin turns it on).
 *
 * Logs carry events, ids, counts and states only: never tokens, sheet values, names or numbers.
 */
import {
  SHEETS_LEAD_COLUMNS,
  SheetsAgentSettings,
  googleSheetUrl,
  spreadsheetIdFromLink,
  type SheetsActivity,
  type SpreadsheetInfo,
  type GoogleSheetsStatus,
} from '@ezychat/shared';
import { agentById } from '../../ai/agents.js';
import { AI_TIMEZONE_SETTING, resolveAiTimeZone } from '../../ai/prompt.js';
import type { AppContext } from '../../context.js';
import { audit } from '../../db/audit.js';
import { HttpError, errors } from '../../http/errors.js';
import { getChats } from '../../wa-bridge/index.js';
import { createGoogleAccount } from '../google-account.js';
import { customerWrote } from '../google-calendar/contact.js';
import { GoogleError } from '../google-calendar/google.js';
import { customerTexts } from '../google-calendar/repo.js';
import { FAKE_SHEETS_APP, FAKE_SHEETS_ENDPOINTS, FakeGoogleSheets } from './fake.js';
import { matchRows, type MatchResult } from './match.js';
import {
  addActivity,
  insertLead,
  leadAddedSince,
  listActivity,
  readSettings,
  writeSettings,
} from './repo.js';
import {
  SHEETS_ENDPOINTS,
  SHEETS_REQUIRED_SCOPES,
  SHEETS_SCOPES,
  SheetsClient,
  type SpreadsheetMeta,
} from './sheets.js';

declare module '../../context.js' {
  interface Services {
    googleSheets?: GoogleSheetsService;
  }
}

export const TOKENS_SETTING = 'google_sheets_tokens';
export const PROBLEM_SETTING = 'google_sheets_problem';
export const FAKE_CONSENT_PATH = '/api/dev/fake-google-sheets/consent';
const META_TTL_MS = 5 * 60_000;
/** A look-up reads the tab again after this long (several look-ups in one turn share one read). */
const VALUES_TTL_MS = 60_000;
const MAX_CACHED = 50;
export const LEAD_REQUEST_CHARACTERS = 500;

export type AddLeadResult =
  | { ok: true; already: boolean }
  | { ok: false; reason: 'not_allowed' | 'group' | 'no_name' }
  | { ok: false; reason: 'not_from_customer'; field: 'name' | 'email' };

export interface GoogleSheetsServiceOptions {
  /** Overrides the client (tests); default from the build's Google app, or the fake with --fake-wa. */
  client?: SheetsClient | null;
  fake?: FakeGoogleSheets | null;
  now?: () => number;
}

/** What one agent may do now (connected and switched on), else null. */
export interface UsableSheets {
  settings: SheetsAgentSettings;
  spreadsheetId: string;
  lookupTab: string | null;
  leadsTab: string | null;
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export function createGoogleSheetsService(
  ctx: AppContext,
  options: GoogleSheetsServiceOptions = {},
) {
  const log = ctx.log.child({ mod: 'google-sheets' });
  const now = options.now ?? Date.now;
  // The fake replaces Google only with --fake-wa (never in service mode) and no Google app
  // configured: a Dev Build with GOOGLE_OAUTH_CLIENT_ID/_SECRET talks to real Google.
  const fake =
    options.fake !== undefined
      ? options.fake
      : ctx.config.fakeWa && ctx.config.mode !== 'service' && !ctx.config.googleOAuth
        ? new FakeGoogleSheets()
        : null;
  const client: SheetsClient | null =
    options.client !== undefined
      ? options.client
      : fake
        ? new SheetsClient(FAKE_SHEETS_APP, FAKE_SHEETS_ENDPOINTS, fake.fetch)
        : ctx.config.googleOAuth
          ? new SheetsClient(ctx.config.googleOAuth, SHEETS_ENDPOINTS)
          : null;

  const account = createGoogleAccount(ctx, {
    key: 'google_sheets',
    label: 'Google Sheets',
    tokensSetting: TOKENS_SETTING,
    problemSetting: PROBLEM_SETTING,
    scopes: SHEETS_SCOPES,
    requiredScopes: SHEETS_REQUIRED_SCOPES,
    client,
    fake,
    fakeConsentPath: FAKE_CONSENT_PATH,
    now,
  });

  const metas = new Map<string, { at: number; meta: SpreadsheetMeta }>();
  const values = new Map<string, { at: number; rows: string[][] }>();
  const clearCaches = () => {
    metas.clear();
    values.clear();
  };
  account.onChange(clearCaches);
  const remember = <T>(map: Map<string, T>, key: string, value: T) => {
    if (map.size >= MAX_CACHED) map.delete(map.keys().next().value!);
    map.set(key, value);
  };

  const linked = () => {
    const state = account.state();
    return state === 'connected' || state === 'unavailable';
  };

  async function meta(id: string, force = false, signal?: AbortSignal): Promise<SpreadsheetMeta> {
    const cached = metas.get(id);
    if (!force && cached && now() - cached.at < META_TTL_MS) return cached.meta;
    const fresh = await account.withToken((token) => client!.spreadsheet(token, id, signal));
    remember(metas, id, { at: now(), meta: fresh });
    return fresh;
  }

  async function tabValues(id: string, tab: string, signal?: AbortSignal): Promise<string[][]> {
    const key = `${id}\n${tab}`;
    const cached = values.get(key);
    if (cached && now() - cached.at < VALUES_TTL_MS) return cached.rows;
    const rows = await account.withToken((token) => client!.values(token, id, tab, signal));
    remember(values, key, { at: now(), rows });
    return rows;
  }

  /** A sheet the account cannot open answers 400; Google out of reach 503. */
  async function checkedMeta(id: string): Promise<SpreadsheetMeta> {
    try {
      return await meta(id, true);
    } catch (error) {
      if (error instanceof GoogleError && error.kind === 'rejected')
        throw errors.validation(
          'The connected Google account cannot open this spreadsheet. Share it with that account, or check the link.',
        );
      throw new HttpError(503, 'google_unavailable', 'Google Sheets could not be reached');
    }
  }

  function timeZone(): string {
    return resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null));
  }

  /** The customer's name and WhatsApp number as the team saved them (never for a group). */
  function savedContact(chatJid: string): {
    name: string | null;
    email: string | null;
    phone: string | null;
  } {
    const chat = getChats(ctx).get(chatJid);
    if (!chat || chat.type === 'group') return { name: null, email: null, phone: null };
    const profile = ctx.services.customers?.profile(chatJid).profile ?? null;
    // A chat named after its number has no real name.
    const named = (value: string | null | undefined) =>
      value?.trim() && /\p{L}/u.test(value) ? value.trim() : null;
    return {
      name: named(profile?.name) ?? named(chat.name) ?? named(chat.whatsappName),
      email: profile?.email?.trim() || null,
      phone:
        chat.phone ?? (chat.waJid.endsWith('@s.whatsapp.net') ? chat.waJid.split('@')[0]! : null),
    };
  }

  function localTime(at: number): string {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: timeZone(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  }

  const service = {
    fake,
    account,
    configured: account.configured,
    timeZone,
    savedContact,

    status(): GoogleSheetsStatus {
      const tokens = account.configured() ? account.tokens() : null;
      return {
        state: account.state(),
        account: tokens?.account ?? null,
        connectedAt: tokens?.connectedAt ?? null,
        problemSince: account.problemSince(),
      };
    },

    /** The agent's spreadsheet and the tabs it may use now, else null. */
    usable(agentId: number | undefined | null): UsableSheets | null {
      if (agentId === undefined || agentId === null) return null;
      if (!linked() || !agentById(ctx.db, agentId)) return null;
      const settings = readSettings(ctx.db, agentId);
      if (!settings.spreadsheetId) return null;
      const lookupTab = settings.lookup ? settings.lookupTab : null;
      const leadsTab = settings.addLeads ? settings.leadsTab : null;
      if (!lookupTab && !leadsTab) return null;
      return { settings, spreadsheetId: settings.spreadsheetId, lookupTab, leadsTab };
    },

    /** Settings tab: the spreadsheet behind a pasted link (name and tabs). */
    async spreadsheetInfo(link: string): Promise<SpreadsheetInfo> {
      if (!linked()) throw new HttpError(409, 'not_connected', 'Connect a Google account first');
      const id = spreadsheetIdFromLink(link);
      if (!id) throw errors.validation('Paste the link of a Google Sheets spreadsheet');
      const found = await checkedMeta(id);
      return { id, name: found.name, tabs: found.tabs, url: googleSheetUrl(id) };
    },

    getSettings(agentId: number): SheetsAgentSettings {
      if (!agentById(ctx.db, agentId)) throw errors.notFound('Agent');
      return readSettings(ctx.db, agentId);
    },

    async putSettings(
      agentId: number,
      next: SheetsAgentSettings,
      actor: { userId: number; ip: string | null },
    ): Promise<SheetsAgentSettings> {
      if (!agentById(ctx.db, agentId)) throw errors.notFound('Agent');
      const parsed = SheetsAgentSettings.parse(next);
      const before = readSettings(ctx.db, agentId);
      let saved: SheetsAgentSettings = parsed;
      if (!parsed.spreadsheetId)
        saved = {
          ...parsed,
          spreadsheetName: null,
          lookupTab: null,
          leadsTab: null,
          addLeads: false,
        };
      else if (linked()) {
        // The spreadsheet and both tabs must exist for the connected account.
        const found = await checkedMeta(parsed.spreadsheetId);
        const titles = new Set(found.tabs.map((tab) => tab.title));
        if (parsed.lookupTab && !titles.has(parsed.lookupTab))
          throw errors.validation('Choose a tab of this spreadsheet to look up');
        if (parsed.leadsTab && !titles.has(parsed.leadsTab))
          throw errors.validation('Choose a tab of this spreadsheet for new leads');
        saved = { ...parsed, spreadsheetName: found.name };
      } else if (parsed.spreadsheetId !== before.spreadsheetId)
        throw new HttpError(409, 'not_connected', 'Connect a Google account first');
      else saved = { ...parsed, spreadsheetName: before.spreadsheetName };
      const fields = (Object.keys(saved) as Array<keyof SheetsAgentSettings>).filter(
        (key) => key !== 'spreadsheetName' && before[key] !== saved[key],
      );
      writeSettings(ctx.db, agentId, saved, now());
      if (fields.length)
        audit(ctx.db, {
          userId: actor.userId,
          action: 'google_sheets.agent_settings',
          ip: actor.ip,
          meta: { agentId, fields },
        });
      return saved;
    },

    activity(): SheetsActivity[] {
      return listActivity(ctx.db);
    },

    addActivity(row: Parameters<typeof addActivity>[1]) {
      addActivity(ctx.db, row, now());
    },

    /** The rows of the look-up tab that answer `query` (whole tab when it is small). */
    async lookup(usable: UsableSheets, query: string, signal?: AbortSignal): Promise<MatchResult> {
      const rows = await tabValues(usable.spreadsheetId, usable.lookupTab!, signal);
      return matchRows(rows, query);
    },

    /**
     * Adds this chat's customer as one row of the leads tab. Guards: switched on for this agent, a
     * direct chat, at most one row per chat and spreadsheet in 24 hours, a name (saved, or written
     * by the customer in this chat) and an email only as the customer wrote it. Google errors are
     * thrown (the tool hands over).
     */
    async addLead(
      agentId: number,
      chatJid: string,
      input: { request: string; name?: string; email?: string },
      signal?: AbortSignal,
    ): Promise<AddLeadResult> {
      const usable = service.usable(agentId);
      if (!usable?.leadsTab) return { ok: false, reason: 'not_allowed' };
      const chat = getChats(ctx).get(chatJid);
      if (!chat || chat.type === 'group') return { ok: false, reason: 'group' };
      if (leadAddedSince(ctx.db, chatJid, usable.spreadsheetId, now()))
        return { ok: true, already: true };
      const saved = savedContact(chatJid);
      const texts = customerTexts(ctx.db, chatJid);
      const given = { name: input.name?.trim(), email: input.email?.trim() };
      for (const field of ['name', 'email'] as const) {
        const value = given[field];
        if (value && !customerWrote(texts, field, value))
          return { ok: false, reason: 'not_from_customer', field };
      }
      const name = given.name || saved.name;
      if (!name) return { ok: false, reason: 'no_name' };
      const agentName = agentById(ctx.db, agentId)?.displayName ?? '';
      const row = [
        localTime(now()),
        oneLine(name).slice(0, 100),
        saved.phone ? `+${saved.phone}` : '',
        oneLine(given.email || saved.email || '').slice(0, 254),
        oneLine(input.request).slice(0, LEAD_REQUEST_CHARACTERS),
        agentName,
      ];
      const tab = usable.leadsTab;
      const current = await tabValues(usable.spreadsheetId, tab, signal);
      const rows = current.some((r) => r.some((cell) => cell.trim()))
        ? [row]
        : [[...SHEETS_LEAD_COLUMNS], row];
      await account.withToken((token) =>
        client!.append(token, usable.spreadsheetId, tab, rows, signal),
      );
      values.delete(`${usable.spreadsheetId}\n${tab}`);
      insertLead(ctx.db, { agentId, chatJid, spreadsheetId: usable.spreadsheetId }, now());
      addActivity(ctx.db, { kind: 'lead_added', agentId, chatJid }, now());
      log.info({ event: 'google_sheets_lead_added', agentId }, 'AI added a lead row');
      return { ok: true, already: false };
    },

    startConnect: account.startConnect,
    progress: account.progress,
    callback: account.callback,
    fakeConsent: account.fakeConsent,

    async disconnect(actor: { userId: number; ip: string | null }) {
      await account.disconnect(actor);
    },

    shutdown() {
      account.shutdown();
      clearCaches();
    },
  };
  return service;
}

export type GoogleSheetsService = ReturnType<typeof createGoogleSheetsService>;

export function initGoogleSheets(ctx: AppContext) {
  ctx.services.googleSheets = createGoogleSheetsService(ctx);
}

export function getGoogleSheets(ctx: AppContext): GoogleSheetsService {
  const service = ctx.services.googleSheets;
  if (!service) throw new Error('Google Sheets service not initialised');
  return service;
}
