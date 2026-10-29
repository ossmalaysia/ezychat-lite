/**
 * Zoho CRM connector (core; design docs/features/zoho-crm/design.md). One Zoho account per install:
 * tokens only in an encrypted setting, refreshed before expiry. Per AI agent: Find the customer
 * (look-up by WhatsApp number) and Add new leads (one Lead per chat, server-guarded). Teammates
 * see the chat's record in the customer panel and may add the number as a lead.
 *
 * Logs carry counts, ids and states only: never tokens, codes, names, emails or phone numbers.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  ZohoCrmAgentSettings,
  zohoCrmHost,
  type ZohoCrmActivity,
  type ZohoCrmChatRecord,
  type ZohoCrmConnectProgress,
  type ZohoCrmConnectStart,
  type ZohoCrmModule,
  type ZohoCrmRecord,
  type ZohoCrmStatus,
  type ZohoRegion,
} from '@ezychat/shared';
import { z } from 'zod';
import { agentById } from '../../ai/agents.js';
import type { AppContext } from '../../context.js';
import { audit } from '../../db/audit.js';
import { HttpError, errors } from '../../http/errors.js';
import { getChats } from '../../wa-bridge/index.js';
import { customerTexts } from '../google-calendar/repo.js';
import { customerWrote } from '../google-calendar/contact.js';
import { FAKE_ZOHO_APP, FAKE_ZOHO_HOSTS, FakeZoho } from './fake.js';
import {
  addActivity,
  insertLead,
  leadFor,
  listActivity,
  readSettings,
  writeSettings,
} from './repo.js';
import {
  ZOHO_HOSTS,
  ZohoClient,
  ZohoError,
  type ZohoFoundRecord,
  type ZohoTokens,
} from './zoho.js';

declare module '../../context.js' {
  interface Services {
    zohoCrm?: ZohoCrmService;
  }
}

export const TOKENS_SETTING = 'zoho_crm_tokens';
export const PROBLEM_SETTING = 'zoho_crm_problem';
export const CONNECT_TTL_MS = 10 * 60_000;
/** A look-up result is reused this long (Zoho counts API credits per day). */
export const LOOKUP_TTL_MS = 10 * 60_000;
const MAX_PENDING = 20;
const MAX_CACHED = 500;
const ACCOUNT_TTL_MS = 5 * 60_000;
const REFRESH_EARLY_MS = 60_000;
export const REQUEST_CHARACTERS = 200;

interface StoredTokens extends ZohoTokens {
  region: ZohoRegion;
  connectedAt: number;
}

interface Problem {
  state: 'expired' | 'unavailable';
  since: number;
}

interface Pending {
  requestId: string;
  region: ZohoRegion;
  redirectUri: string;
  createdAt: number;
  userId: number;
  ip: string | null;
  status: ZohoCrmConnectProgress['status'];
  error: ZohoCrmConnectProgress['error'];
  used: boolean;
}

interface Account {
  at: number;
  me: string | null;
  org: string | null;
  domain: string | null;
  users: Array<{ id: string; name: string }>;
}

export interface CallbackPage {
  status: number;
  title: string;
  message: string;
}

/** What the AI may pass to add_crm_lead: only details the customer wrote in this chat. */
export interface LeadDetails {
  name?: string;
  company?: string;
  email?: string;
  /** The AI's one-line summary of the request (kept only when the agent's setting allows it). */
  request?: string;
}

export type AddLeadResult =
  | { ok: true; recordId: string; already: boolean }
  | { ok: false; reason: 'exists'; module: ZohoCrmModule }
  | { ok: false; reason: 'no_name' | 'no_number' | 'not_allowed' | 'invalid_email' }
  | { ok: false; reason: 'not_from_customer'; field: 'name' | 'company' | 'email' };

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const isEmail = (text: string) => z.string().email().max(254).safeParse(text).success;
/** A chat named after its number has no real name. */
const named = (value: string | null | undefined) =>
  value?.trim() && /\p{L}/u.test(value) ? value.trim() : null;

/** "Dr. Kavitha Menon" → first "Dr. Kavitha", last "Menon"; one word is the last name. */
export function splitName(name: string): { firstName: string | null; lastName: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { firstName: null, lastName: name.trim().slice(0, 80) };
  return {
    firstName: parts.slice(0, -1).join(' ').slice(0, 40),
    lastName: parts.at(-1)!.slice(0, 80),
  };
}

/** One line, at most 200 characters (never a copy of the chat: the AI writes it). */
export function requestLine(text: string | undefined): string | null {
  const line = text?.replace(/\s+/g, ' ').trim();
  return line ? line.slice(0, REQUEST_CHARACTERS) : null;
}

export interface ZohoCrmServiceOptions {
  client?: ZohoClient | null;
  fake?: FakeZoho | null;
  now?: () => number;
}

export function createZohoCrmService(ctx: AppContext, options: ZohoCrmServiceOptions = {}) {
  const log = ctx.log.child({ mod: 'zoho-crm' });
  const now = options.now ?? Date.now;
  // As Google Calendar: the fake only with --fake-wa (never in service mode) and no Zoho app.
  const fake =
    options.fake !== undefined
      ? options.fake
      : ctx.config.fakeWa && ctx.config.mode !== 'service' && !ctx.config.zohoOAuth
        ? new FakeZoho()
        : null;
  const client: ZohoClient | null =
    options.client !== undefined
      ? options.client
      : fake
        ? new ZohoClient(FAKE_ZOHO_APP, FAKE_ZOHO_HOSTS, fake.fetch)
        : ctx.config.zohoOAuth
          ? new ZohoClient(ctx.config.zohoOAuth, ZOHO_HOSTS)
          : null;

  const pending = new Map<string, Pending>();
  const byRequest = new Map<string, string>();
  const lookups = new Map<string, { at: number; record: ZohoFoundRecord | null }>();
  let account: Account | null = null;
  let refreshing: Promise<StoredTokens> | null = null;

  const loadTokens = (): StoredTokens | null => {
    const raw = ctx.settings.getSecret(TOKENS_SETTING);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as StoredTokens;
      return value.accessToken && value.refreshToken && value.apiDomain ? value : null;
    } catch {
      return null;
    }
  };
  const saveTokens = (tokens: StoredTokens | null) =>
    ctx.settings.setSecret(TOKENS_SETTING, tokens ? JSON.stringify(tokens) : null);
  const problem = (): Problem | null => ctx.settings.get<Problem | null>(PROBLEM_SETTING, null);

  function markProblem(error: unknown) {
    if (!(error instanceof ZohoError) || error.kind === 'rejected') return;
    const current = problem();
    if (error.kind === 'unavailable' && current?.state === 'expired') return;
    if (current?.state === error.kind) return;
    log.warn(
      { event: 'zoho_crm_problem', state: error.kind, status: error.status },
      'Zoho CRM problem',
    );
    ctx.settings.set(PROBLEM_SETTING, { state: error.kind, since: now() });
  }
  function clearProblem() {
    if (!problem()) return;
    ctx.settings.set(PROBLEM_SETTING, null);
    log.info({ event: 'zoho_crm_problem', state: 'connected' }, 'Zoho CRM works again');
  }

  async function refreshNow(tokens: StoredTokens): Promise<StoredTokens> {
    if (!refreshing)
      refreshing = (async () => {
        try {
          const fresh = await client!.refresh(tokens);
          const next: StoredTokens = {
            ...fresh,
            region: tokens.region,
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

  /** Runs one Zoho call with a valid access token; records problems and recoveries. */
  async function withToken<T>(fn: (tokens: StoredTokens) => Promise<T>): Promise<T> {
    if (!client) throw new ZohoError('rejected');
    let tokens = loadTokens();
    if (!tokens) throw new ZohoError('rejected');
    try {
      let refreshed = false;
      if (tokens.expiresAt - REFRESH_EARLY_MS <= now()) {
        tokens = await refreshNow(tokens);
        refreshed = true;
      }
      let result: T;
      try {
        result = await fn(tokens);
      } catch (error) {
        // An access token Zoho no longer accepts: refresh once and try again.
        if (refreshed || !(error instanceof ZohoError) || error.status !== 401) throw error;
        tokens = await refreshNow(tokens);
        result = await fn(tokens);
      }
      clearProblem();
      return result;
    } catch (error) {
      markProblem(error);
      throw error;
    }
  }

  async function loadAccount(force = false): Promise<Account> {
    if (!force && account && now() - account.at < ACCOUNT_TTL_MS) return account;
    const [org, users] = await withToken(async (tokens) =>
      Promise.all([client!.organisation(tokens), client!.users(tokens)]),
    );
    account = { at: now(), me: users.me, org: org.name, domain: org.domain, users: users.active };
    return account;
  }

  const configured = () => client !== null;

  function state(): ZohoCrmStatus['state'] {
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

  function crmUrl(): string | null {
    const tokens = loadTokens();
    if (!tokens) return null;
    const base = `https://${zohoCrmHost(tokens.region)}/crm/`;
    return account?.domain ? `${base}${account.domain}/` : base;
  }

  function recordUrl(module: ZohoCrmModule, id: string): string | null {
    const tokens = loadTokens();
    if (!tokens || !account?.domain) return null;
    return `https://${zohoCrmHost(tokens.region)}/crm/${account.domain}/tab/${module}/${id}`;
  }

  /** The chat's WhatsApp number (digits), or null for a group or an unknown number. */
  function chatNumber(chatJid: string): string | null {
    const chat = getChats(ctx).get(chatJid);
    if (!chat || chat.type === 'group') return null;
    const phone =
      chat.phone ?? (chat.waJid.endsWith('@s.whatsapp.net') ? chat.waJid.split('@')[0]! : null);
    const digits = phone?.replace(/\D/g, '') ?? '';
    return digits.length >= 7 ? digits : null;
  }

  /** The chat's Contact or Lead (cached for 10 minutes unless `fresh`); Zoho errors are thrown. */
  async function find(chatJid: string, fresh = false, signal?: AbortSignal) {
    const digits = chatNumber(chatJid);
    if (!digits) return null;
    const cached = lookups.get(digits);
    if (!fresh && cached && now() - cached.at < LOOKUP_TTL_MS) return cached.record;
    const record = await withToken((tokens) => client!.findByPhone(tokens, digits, signal));
    if (lookups.size >= MAX_CACHED) lookups.delete(lookups.keys().next().value!);
    lookups.set(digits, { at: now(), record });
    return record;
  }

  /** The name, company and email a new lead gets from the saved contact (team or WhatsApp). */
  function savedContact(chatJid: string) {
    const chat = getChats(ctx).get(chatJid);
    const profile = ctx.services.customers?.profile(chatJid).profile ?? null;
    return {
      name: named(profile?.name) ?? named(chat?.name) ?? named(chat?.whatsappName),
      company: profile?.company?.trim() || null,
      email: profile?.email?.trim() || null,
    };
  }

  async function createLead(input: {
    chatJid: string;
    digits: string;
    name: string;
    company: string | null;
    email: string | null;
    request: string | null;
    settings: Pick<ZohoCrmAgentSettings, 'ownerId' | 'leadSource'>;
    signal?: AbortSignal;
  }): Promise<string> {
    const { firstName, lastName } = splitName(input.name);
    const id = await withToken((tokens) =>
      client!.createLead(
        tokens,
        {
          firstName,
          lastName,
          // Zoho's standard Leads layout requires a company: the person's name stands in.
          company: (input.company ?? input.name).slice(0, 200),
          phone: `+${input.digits}`,
          email: input.email,
          leadSource: input.settings.leadSource,
          description: input.request,
          ownerId: input.settings.ownerId,
        },
        input.signal,
      ),
    );
    lookups.set(input.digits, {
      at: now(),
      record: {
        module: 'Leads',
        id,
        name: input.name,
        company: input.company,
        owner: null,
        status: null,
      },
    });
    return id;
  }

  const service = {
    fake,
    configured,

    /** The agent's settings when its Zoho CRM tools may be offered now, else null. */
    usable(agentId: number | undefined | null): ZohoCrmAgentSettings | null {
      if (agentId === undefined || agentId === null) return null;
      const current = state();
      if (current !== 'connected' && current !== 'unavailable') return null;
      if (!agentById(ctx.db, agentId)) return null;
      const settings = readSettings(ctx.db, agentId);
      return settings.find ? settings : null;
    },

    async status(): Promise<ZohoCrmStatus> {
      const tokens = configured() ? loadTokens() : null;
      if (tokens && problem()?.state !== 'expired') await loadAccount().catch(() => undefined);
      const current = state();
      const on = current !== 'not_configured' && !!tokens;
      return {
        state: current,
        region: on ? tokens.region : null,
        account: on ? (account?.me ?? null) : null,
        org: on ? (account?.org ?? null) : null,
        users: on ? (account?.users ?? []) : [],
        crmUrl: on ? crmUrl() : null,
        connectedAt: tokens?.connectedAt ?? null,
        problemSince:
          current === 'expired' || current === 'unavailable' ? (problem()?.since ?? null) : null,
      };
    },

    /** Starts a sign-in in the account's data centre (with --fake-wa: the local consent page). */
    startConnect(
      region: ZohoRegion,
      redirectUri: string,
      actor: { userId: number; ip: string | null },
    ): ZohoCrmConnectStart {
      if (!client)
        throw new HttpError(409, 'not_configured', 'Zoho sign-in is not set up in this build');
      prune();
      while (pending.size >= MAX_PENDING) {
        const oldest = pending.keys().next().value!;
        byRequest.delete(pending.get(oldest)!.requestId);
        pending.delete(oldest);
      }
      const stateParam = randomBytes(24).toString('base64url');
      const requestId = randomBytes(12).toString('hex');
      pending.set(sha(stateParam), {
        requestId,
        region,
        redirectUri,
        createdAt: now(),
        userId: actor.userId,
        ip: actor.ip,
        status: 'pending',
        error: null,
        used: false,
      });
      byRequest.set(requestId, sha(stateParam));
      let authorizationUrl: string;
      if (fake) {
        const url = new URL('/api/dev/fake-zoho/consent', redirectUri);
        url.searchParams.set('state', stateParam);
        authorizationUrl = url.toString();
      } else authorizationUrl = client.authorizationUrl({ region, redirectUri, state: stateParam });
      log.info({ event: 'zoho_crm_connect_start', region }, 'Zoho sign-in started');
      return { requestId, authorizationUrl };
    },

    progress(requestId: string): ZohoCrmConnectProgress | null {
      const hash = byRequest.get(requestId);
      const entry = hash ? pending.get(hash) : undefined;
      if (!entry) return null;
      if (entry.status === 'pending' && now() - entry.createdAt > CONNECT_TTL_MS)
        return { status: 'failed', error: 'expired' };
      return { status: entry.status, error: entry.error };
    },

    /**
     * The redirect from Zoho: one-time `state`, then the code is exchanged at the accounts server
     * Zoho names (`accounts-server`, checked against Zoho's hosts), else the region's own.
     */
    async callback(query: Record<string, unknown>): Promise<CallbackPage> {
      const expiredPage: CallbackPage = {
        status: 400,
        title: 'Sign-in link expired',
        message: 'Start the Zoho sign-in again from EzyChat.',
      };
      const stateParam = typeof query.state === 'string' ? query.state : '';
      const entry = stateParam ? pending.get(sha(stateParam)) : undefined;
      if (!entry || entry.used) return expiredPage;
      entry.used = true;
      if (now() - entry.createdAt > CONNECT_TTL_MS) {
        entry.status = 'failed';
        entry.error = 'expired';
        return expiredPage;
      }
      const fail = (error: 'denied' | 'error', title: string): CallbackPage => {
        entry.status = 'failed';
        entry.error = error;
        log.info({ event: 'zoho_crm_connect_failed', reason: error }, 'Zoho sign-in failed');
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
      const named = typeof query['accounts-server'] === 'string' ? query['accounts-server'] : '';
      const accountsServer = named || client!.hosts.accounts(entry.region);
      if (!client!.hosts.isAccountsServer(accountsServer)) return fail('error', 'Sign-in failed');
      let tokens: ZohoTokens;
      try {
        tokens = await client!.exchangeCode(code, entry.redirectUri, accountsServer);
      } catch (error) {
        log.warn(
          { event: 'zoho_crm_exchange_failed', status: (error as ZohoError)?.status ?? null },
          'Zoho sign-in exchange failed',
        );
        return fail('error', 'Sign-in failed');
      }
      saveTokens({ ...tokens, region: entry.region, connectedAt: now() });
      ctx.settings.set(PROBLEM_SETTING, null);
      account = null;
      lookups.clear();
      entry.status = 'done';
      audit(ctx.db, {
        userId: entry.userId,
        action: 'zoho_crm.connect',
        ip: entry.ip,
        meta: { region: entry.region },
      });
      log.info({ event: 'zoho_crm_connected', region: entry.region }, 'Zoho CRM connected');
      return {
        status: 200,
        title: 'Zoho CRM connected',
        message: 'You can close this window and return to EzyChat.',
      };
    },

    /** Fake consent page (--fake-wa only): where Accept / Cancel lead, always our own callback. */
    fakeConsent(stateParam: string, allow: boolean): string | null {
      if (!fake) return null;
      const entry = pending.get(sha(stateParam));
      if (!entry || entry.used) return null;
      const url = new URL(entry.redirectUri);
      url.searchParams.set('state', stateParam);
      if (allow) {
        url.searchParams.set('code', fake.issueCode());
        url.searchParams.set('accounts-server', client!.hosts.accounts(entry.region));
      } else url.searchParams.set('error', 'access_denied');
      return url.toString();
    },

    async disconnect(actor: { userId: number; ip: string | null }): Promise<void> {
      const tokens = loadTokens();
      saveTokens(null);
      ctx.settings.set(PROBLEM_SETTING, null);
      account = null;
      lookups.clear();
      if (tokens && client) await client.revoke(tokens);
      audit(ctx.db, { userId: actor.userId, action: 'zoho_crm.disconnect', ip: actor.ip });
      log.info({ event: 'zoho_crm_disconnected' }, 'Zoho CRM disconnected');
    },

    getSettings(agentId: number): ZohoCrmAgentSettings {
      if (!agentById(ctx.db, agentId)) throw errors.notFound('Agent');
      return readSettings(ctx.db, agentId);
    },

    async putSettings(
      agentId: number,
      next: ZohoCrmAgentSettings,
      actor: { userId: number; ip: string | null },
    ): Promise<ZohoCrmAgentSettings> {
      if (!agentById(ctx.db, agentId)) throw errors.notFound('Agent');
      const parsed = ZohoCrmAgentSettings.parse(next);
      const current = state();
      if (parsed.ownerId !== null && (current === 'connected' || current === 'unavailable')) {
        let users: Account['users'];
        try {
          users = (await loadAccount(true)).users;
        } catch {
          throw new HttpError(503, 'zoho_unavailable', 'Zoho CRM could not be reached');
        }
        if (!users.some((user) => user.id === parsed.ownerId))
          throw errors.validation('Choose an active Zoho CRM user as the lead owner');
      }
      const before = readSettings(ctx.db, agentId);
      const fields = (Object.keys(parsed) as Array<keyof ZohoCrmAgentSettings>).filter(
        (key) => before[key] !== parsed[key],
      );
      writeSettings(ctx.db, agentId, parsed, now());
      if (fields.length)
        audit(ctx.db, {
          userId: actor.userId,
          action: 'zoho_crm.agent_settings',
          ip: actor.ip,
          meta: { agentId, changed: fields },
        });
      return parsed;
    },

    activity(): ZohoCrmActivity[] {
      return listActivity(ctx.db);
    },

    addActivity(row: Parameters<typeof addActivity>[1]) {
      addActivity(ctx.db, row, now());
    },

    /** The AI's look-up: the chat's Contact or Lead, or null. Zoho errors are thrown. */
    async findCustomer(chatJid: string, signal?: AbortSignal): Promise<ZohoFoundRecord | null> {
      return find(chatJid, false, signal);
    },

    /** True when this chat has a number Zoho CRM can be searched by. */
    hasNumber(chatJid: string): boolean {
      return chatNumber(chatJid) !== null;
    },

    /** Which details a new lead would get without asking (for the tool's note to the AI). */
    savedContact,

    /**
     * Adds a Lead for this chat. Guards: Add new leads is on; one lead per chat; the number is in
     * neither Contacts nor Leads (searched again, not from the cache); a name (saved, or written by
     * the customer); every detail the AI passes appears in the customer's own messages.
     */
    async addLeadByAi(
      agentId: number,
      chatJid: string,
      details: LeadDetails,
      signal?: AbortSignal,
    ): Promise<AddLeadResult> {
      const settings = service.usable(agentId);
      if (!settings?.addLeads) return { ok: false, reason: 'not_allowed' };
      const digits = chatNumber(chatJid);
      if (!digits) return { ok: false, reason: 'no_number' };
      const existing = leadFor(ctx.db, chatJid);
      if (existing) return { ok: true, recordId: existing.recordId, already: true };
      const texts = customerTexts(ctx.db, chatJid);
      const saved = savedContact(chatJid);
      const given: Record<'name' | 'company' | 'email', string | null> = {
        name: null,
        company: null,
        email: null,
      };
      for (const field of ['name', 'company', 'email'] as const) {
        const value = details[field]?.trim();
        if (!value) continue;
        if (!customerWrote(texts, field === 'email' ? 'email' : 'name', value))
          return { ok: false, reason: 'not_from_customer', field };
        given[field] = value.slice(0, 200);
      }
      const name = given.name ?? saved.name;
      if (!name) {
        addActivity(ctx.db, { kind: 'not_added', agentId, chatJid, reason: 'no_name' }, now());
        return { ok: false, reason: 'no_name' };
      }
      const email = given.email ?? saved.email;
      if (email && !isEmail(email)) return { ok: false, reason: 'invalid_email' };
      const found = await find(chatJid, true, signal);
      if (found) {
        addActivity(
          ctx.db,
          { kind: 'not_added', agentId, chatJid, module: found.module, reason: 'exists' },
          now(),
        );
        return { ok: false, reason: 'exists', module: found.module };
      }
      const request = settings.includeRequest ? requestLine(details.request) : null;
      const recordId = await createLead({
        chatJid,
        digits,
        name,
        company: given.company ?? saved.company,
        email,
        request,
        settings,
        signal,
      });
      insertLead(
        ctx.db,
        { chatJid, recordId, addedBy: 'ai', agentId, userId: null, request },
        now(),
      );
      addActivity(ctx.db, { kind: 'added', agentId, chatJid, module: 'Leads' }, now());
      log.info({ event: 'zoho_crm_lead_added', by: 'ai', agentId }, 'Zoho CRM lead added');
      return { ok: true, recordId, already: false };
    },

    /** Customer panel: the chat's record for a teammate (cached look-up; never throws for Zoho). */
    async chatRecord(chatJid: string): Promise<ZohoCrmChatRecord> {
      const current = state();
      if (current !== 'connected') return { state: current, record: null };
      let found: ZohoFoundRecord | null;
      try {
        found = await find(chatJid);
        if (found && !account) await loadAccount().catch(() => undefined);
      } catch {
        return { state: state(), record: null };
      }
      if (!found) return { state: state(), record: null };
      const ours = leadFor(ctx.db, chatJid);
      const mine = ours && ours.recordId === found.id ? ours : null;
      const record: ZohoCrmRecord = {
        module: found.module,
        id: found.id,
        name: found.name,
        company: found.company,
        owner: found.owner,
        status: found.status,
        addedBy: mine?.addedBy ?? null,
        request: mine?.request ?? null,
        url: recordUrl(found.module, found.id),
      };
      return { state: state(), record };
    },

    /**
     * "Add as a lead" by a teammate: the saved contact's name (else the WhatsApp name), company
     * and email. 409 when the number is in Zoho CRM or has no name; 503 when Zoho is unavailable.
     */
    async addLeadByTeam(
      chatJid: string,
      actor: { userId: number; ip: string | null },
    ): Promise<ZohoCrmChatRecord> {
      if (state() !== 'connected')
        throw new HttpError(503, 'zoho_unavailable', 'Zoho CRM is not available right now');
      const digits = chatNumber(chatJid);
      if (!digits) throw new HttpError(409, 'no_number', 'This chat has no phone number');
      const saved = savedContact(chatJid);
      if (!saved.name)
        throw new HttpError(409, 'no_name', 'Save the customer’s name first, then add the lead');
      try {
        if (leadFor(ctx.db, chatJid) || (await find(chatJid, true)))
          throw new HttpError(409, 'exists', 'This number is already in Zoho CRM');
        const recordId = await createLead({
          chatJid,
          digits,
          name: saved.name,
          company: saved.company,
          email: saved.email && isEmail(saved.email) ? saved.email : null,
          request: null,
          settings: { ownerId: null, leadSource: 'WhatsApp' },
        });
        insertLead(
          ctx.db,
          {
            chatJid,
            recordId,
            addedBy: 'team',
            agentId: null,
            userId: actor.userId,
            request: null,
          },
          now(),
        );
      } catch (error) {
        if (error instanceof ZohoError)
          throw new HttpError(503, 'zoho_unavailable', 'Zoho CRM is not available right now');
        throw error;
      }
      addActivity(
        ctx.db,
        { kind: 'added_by_team', userId: actor.userId, chatJid, module: 'Leads' },
        now(),
      );
      audit(ctx.db, {
        userId: actor.userId,
        action: 'zoho_crm.lead_add',
        ip: actor.ip,
        meta: { chatJid },
      });
      log.info({ event: 'zoho_crm_lead_added', by: 'team' }, 'Zoho CRM lead added');
      return service.chatRecord(chatJid);
    },

    /** Re-reads the account (dev route: after the fake's state changed). */
    async refreshStatus(): Promise<ZohoCrmStatus> {
      lookups.clear();
      if (loadTokens()) await loadAccount(true).catch(() => undefined);
      return service.status();
    },

    shutdown() {
      pending.clear();
      byRequest.clear();
      lookups.clear();
    },
  };
  return service;
}

export type ZohoCrmService = ReturnType<typeof createZohoCrmService>;

export function initZohoCrm(ctx: AppContext) {
  ctx.services.zohoCrm = createZohoCrmService(ctx);
}

export function getZohoCrm(ctx: AppContext): ZohoCrmService {
  const service = ctx.services.zohoCrm;
  if (!service) throw new Error('Zoho CRM service not initialised');
  return service;
}
