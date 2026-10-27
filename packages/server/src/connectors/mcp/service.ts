/**
 * Partner (MCP) connections from the connector list (design: docs/features/connector-list/design.md,
 * Sign-in types). EzyChat is the MCP client on the customer's computer: it connects straight to the
 * partner's server with one of five sign-ins (oauth, oauth_own_app, api_key, credentials, none),
 * keeps secrets encrypted in the data folder, lists the partner's tools (Test connection) and keeps
 * per-agent settings. The AI bridge and the declared guards are in tools.ts and guards.ts.
 *
 * The connection engine is ported from Enterprise ent-connectors (net.ts, mcp.ts, oauth.ts,
 * credentials.ts). Logs carry connector ids, tool names, outcomes and ms only: never addresses with
 * secrets, keys, tokens, arguments, results or customer text.
 */
import { auth as oauthFlow } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  ConnectorAgentSettings,
  type ConnectorActivity,
  type ConnectorConnectBody,
  type ConnectorConnectionView,
  type ConnectorConnectProgress,
  type ConnectorConnectResult,
  type ConnectorEntry,
  type ConnectorProblem,
  type ConnectorSetting,
  type ConnectorTestResult,
  type ConnectorTool,
} from '@ezychat/shared';
import { agentById } from '../../ai/agents.js';
import { AI_TIMEZONE_SETTING, resolveAiTimeZone } from '../../ai/prompt.js';
import type { ServerConfig } from '../../config.js';
import type { AppContext } from '../../context.js';
import { audit } from '../../db/audit.js';
import { HttpError, errors } from '../../http/errors.js';
import { getChats } from '../../wa-bridge/index.js';
import { customerTexts } from '../google-calendar/repo.js';
import type { ConnectorConnectionsPort } from '../list/types.js';
import {
  buildHeaders,
  checkCredentials,
  checkSecret,
  fillUrl,
  type HeaderAuth,
} from './credentials.js';
import {
  interpretResult,
  listToolDefinitions,
  McpError,
  openClient,
  partnerTool,
  type CallOutcome,
  type McpFailure,
  type OpenClient,
  type PartnerTool,
} from './mcp.js';
import {
  connectorUrlProblem,
  guardedFetch,
  NetProbe,
  REQUEST_TIMEOUT_MS,
  type NetPolicy,
} from './net.js';
import { ConnectorOAuthProvider, PendingSignIns, tokensExpired, type OAuthState } from './oauth.js';
import {
  addActivity,
  clearConnection,
  getConnection,
  listActivity,
  listConnections,
  readAgentSettings,
  recordCall,
  releaseCall,
  recordValues,
  saveConnection,
  setSecret,
  setState,
  setTools,
  writeAgentSettings,
  type ActivityReason,
  type ConnectionRow,
  type ConnectionState,
} from './repo.js';

declare module '../../context.js' {
  interface Services {
    connectorMcp?: ConnectorMcpService;
  }
}

/** TEST ONLY switch (with a fake-WhatsApp or dev run): partner servers on this computer. */
export const TEST_ALLOW_LOCAL_ENV = 'CONNECTORS_TEST_ALLOW_LOCAL';
const MAX_CHOICES = 100;

/**
 * The test-only loopback allowance: the env switch AND a dev run with fake WhatsApp (as the list's
 * dev switches), never a packaged or installed app. Nothing in the UI or the API can turn it on.
 */
export function testAllowance(
  config: Pick<ServerConfig, 'mode' | 'fakeWa'>,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[TEST_ALLOW_LOCAL_ENV] === '1' && config.mode === 'dev' && config.fakeWa === true;
}

/** What is stored encrypted per connection. */
export type ConnectionSecret =
  | { type: 'none' }
  | { type: 'api_key' | 'credentials'; values: Record<string, string> }
  | { type: 'oauth' | 'oauth_own_app'; oauth: OAuthState };

export interface CallbackPage {
  status: number;
  title: string;
  message: string;
}

const MESSAGES: Record<ConnectorProblem, string> = {
  refused: 'The partner did not accept the sign-in',
  unreachable: 'The partner server did not answer',
  cancelled: 'Sign-in was cancelled',
  expired: 'This sign-in request has expired. Start again.',
  not_https: 'The partner address must start with https://',
  private_address: 'Addresses on this computer or the local network are not allowed',
  missing_tools: 'The partner server does not offer every tool this connector needs',
};
const STATUS: Record<ConnectorProblem, number> = {
  refused: 400,
  unreachable: 502,
  cancelled: 400,
  expired: 400,
  not_https: 400,
  private_address: 400,
  missing_tools: 409,
};

/** A connect or test failure the routes answer as `{ error: { code: <problem>, message } }`. */
export function problemError(problem: ConnectorProblem): HttpError {
  return new HttpError(STATUS[problem], problem, MESSAGES[problem]);
}

function problemOf(failure: McpFailure): ConnectorProblem {
  if (failure === 'url_private') return 'private_address';
  return failure === 'unauthorized' ? 'refused' : 'unreachable';
}

function stateOf(failure: McpFailure): ConnectionState {
  return failure === 'unauthorized' ? 'needs_sign_in' : 'unreachable';
}

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');

/** An entry this app can connect: a list connector of kind `mcp` with an address, sign-in and tools. */
function isMcp(entry: ConnectorEntry | null | undefined): entry is ConnectorEntry {
  return !!entry && entry.kind === 'mcp' && !!entry.mcp && !!entry.auth && !!entry.tools?.length;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Checks one setting value against its declaration; throws a 400 with the setting id. */
function checkSettingValue(def: ConnectorSetting, value: unknown): unknown {
  const bad = () => errors.validation(`${def.id}: not a valid value`);
  switch (def.type) {
    case 'text':
      if (typeof value !== 'string' || value.length > 500) throw bad();
      return value.trim();
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw bad();
      return value;
    case 'toggle':
      if (typeof value !== 'boolean') throw bad();
      return value;
    case 'select':
      if (typeof value !== 'string' || !def.options?.some((o) => o.value === value)) throw bad();
      return value;
    case 'days': {
      if (
        !Array.isArray(value) ||
        value.length > 7 ||
        !value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ||
        new Set(value).size !== value.length
      )
        throw bad();
      return [...(value as number[])].sort((a, b) => a - b);
    }
    case 'timeRange': {
      const [from, to] = Array.isArray(value) ? (value as unknown[]) : [];
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        typeof from !== 'string' ||
        typeof to !== 'string' ||
        !HHMM.test(from) ||
        !HHMM.test(to) ||
        from >= to
      )
        throw bad();
      return [from, to];
    }
    case 'calendarPicker':
      if (typeof value !== 'string' || value.length > 300) throw bad();
      return value;
  }
}

const isBlank = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && !value.trim()) ||
  (Array.isArray(value) && value.length === 0);

/** One connected connector as an agent turn sees it. */
export interface TurnConnector {
  row: ConnectionRow;
  /** The entry the AI follows: the list's current one when it still has the same address and sign-in. */
  entry: ConnectorEntry;
  tools: Array<{ def: ConnectorTool; partner: PartnerTool }>;
  settings: Record<string, unknown>;
}

export interface ConnectorMcpOptions {
  /** TEST ONLY: trust this CA (the test server's certificate) and/or resolve names with this. */
  net?: Pick<NetPolicy, 'ca' | 'resolve' | 'timeoutMs'>;
  /** Environment for the test allowance (default process.env). */
  env?: Record<string, string | undefined>;
  now?: () => number;
}

export function createConnectorMcpService(ctx: AppContext, options: ConnectorMcpOptions = {}) {
  const log = ctx.log.child({ mod: 'connectors-mcp' });
  const now = options.now ?? Date.now;
  const allowLoopback = testAllowance(ctx.config, options.env ?? process.env);
  const policy: NetPolicy = { allowLoopback, ...(allowLoopback ? (options.net ?? {}) : {}) };
  if (allowLoopback) log.warn('TEST ONLY: partner connectors may reach this computer');
  const pending = new PendingSignIns(now);
  /** One OAuth refresh per connector at a time (refresh tokens may be single use). */
  const refreshes = new Map<string, Promise<boolean>>();

  // ── entries and secrets ─────────────────────────────────────────────────────────────────

  const listEntry = (id: string): ConnectorEntry | null => {
    const entry = ctx.services.connectorList?.entry(id) ?? null;
    return isMcp(entry) ? entry : null;
  };

  const readSecret = (row: ConnectionRow): ConnectionSecret | null => {
    if (!row.secret) return null;
    try {
      return JSON.parse(ctx.secret.decrypt(row.secret)) as ConnectionSecret;
    } catch {
      return null;
    }
  };
  const sealSecret = (secret: ConnectionSecret) => ctx.secret.encrypt(JSON.stringify(secret));

  const liveRow = (id: string): ConnectionRow | null => {
    const row = getConnection(ctx.db, id);
    return row && row.state !== 'disconnected' && row.secret ? row : null;
  };

  /**
   * The entry the AI follows for a saved connection: the list's current entry (texts, tools, guards,
   * settings, fixes) while it keeps the same address and sign-in type; otherwise the copy saved at
   * connect time (secrets are only ever sent where they were given).
   */
  function runtimeEntry(row: ConnectionRow): ConnectorEntry {
    const current = listEntry(row.connectorId);
    return current &&
      current.mcp!.url === row.entry.mcp!.url &&
      current.auth!.type === row.entry.auth!.type
      ? current
      : row.entry;
  }

  /** The entry an admin configures: the saved connection's (see runtimeEntry), else the list's. */
  function configEntry(id: string): ConnectorEntry {
    const row = getConnection(ctx.db, id);
    const entry = row && row.state !== 'disconnected' ? runtimeEntry(row) : listEntry(id);
    if (!entry) throw errors.notFound('Connector');
    return entry;
  }

  /** The partner address, checked against the net policy (https, no private address). */
  function checkedUrl(template: string, fields: Readonly<Record<string, string>>): string {
    const url = fillUrl(template, fields);
    const problem = connectorUrlProblem(url, allowLoopback);
    if (problem === 'url_not_https') throw problemError('not_https');
    if (problem === 'url_private') throw problemError('private_address');
    if (problem) throw errors.validation('The connector address is not valid');
    return new URL(url).href;
  }

  // ── reaching a partner ──────────────────────────────────────────────────────────────────

  function headersOf(
    entry: ConnectorEntry,
    secret: ConnectionSecret,
    fields: Record<string, string>,
  ) {
    if (secret.type === 'none') return {};
    if ('values' in secret)
      return buildHeaders(entry.auth as HeaderAuth, { ...fields, ...secret.values });
    const token = secret.oauth.tokens?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * Refreshes a connection's OAuth tokens: one refresh per connector at a time, shared by every
   * caller. `used` = the access token the refused request carried; when a newer one is stored
   * already, nothing is sent. True when usable newer tokens are stored.
   */
  function refreshTokens(id: string, used: string | undefined): Promise<boolean> {
    const running = refreshes.get(id);
    if (running) return running;
    const p = refreshOnce(id, used).finally(() => refreshes.delete(id));
    refreshes.set(id, p);
    return p;
  }

  async function refreshOnce(id: string, used: string | undefined): Promise<boolean> {
    const row = liveRow(id);
    const secret = row ? readSecret(row) : null;
    if (!row || !secret || (secret.type !== 'oauth' && secret.type !== 'oauth_own_app'))
      return false;
    const stored = secret.oauth.tokens;
    if (stored && used && stored.access_token !== used) return true;
    if (!stored?.refresh_token) return false;
    const auth = row.entry.auth as Extract<
      ConnectorEntry['auth'],
      { type: 'oauth' | 'oauth_own_app' }
    >;
    const provider = new ConnectorOAuthProvider(secret.oauth, {
      redirectUrl: secret.oauth.redirectUrl ?? '',
      scope: auth.scopes.join(' ') || undefined,
      interactive: false,
      now,
    });
    const started = now();
    const ok = await oauthFlow(provider, {
      serverUrl: checkedUrl(row.entry.mcp!.url, row.fields),
      scope: auth.scopes.join(' ') || undefined,
      fetchFn: guardedFetch(policy, new NetProbe()),
    }).then(
      (result) => result === 'AUTHORIZED',
      () => false,
    );
    // A disconnect while refreshing wins.
    if (ok && liveRow(id))
      setSecret(ctx.db, id, sealSecret({ type: secret.type, oauth: provider.data }), now());
    log.info(
      { event: 'connector_refresh', connector: id, ok, ms: now() - started },
      'Partner sign-in refreshed',
    );
    return ok;
  }

  /** Opens a saved connection; an OAuth connection refreshes once when the partner refuses it. */
  async function openRow(row: ConnectionRow, signal?: AbortSignal): Promise<OpenClient> {
    const id = row.connectorId;
    const target = () => {
      const current = liveRow(id);
      const secret = current ? readSecret(current) : null;
      if (!current || !secret) throw new McpError('unauthorized');
      return {
        url: checkedUrl(current.entry.mcp!.url, current.fields),
        headers: headersOf(current.entry, secret, current.fields),
        oauth: secret.type === 'oauth' || secret.type === 'oauth_own_app' ? secret.oauth : null,
      };
    };
    let first = target();
    if (first.oauth && tokensExpired(first.oauth, now())) {
      await refreshTokens(id, first.oauth.tokens?.access_token);
      first = target();
    }
    try {
      return await openClient(first.url, first.headers, policy, signal);
    } catch (error) {
      const refused = error instanceof McpError && error.failure === 'unauthorized';
      if (!first.oauth || !refused || signal?.aborted) throw error;
      if (!(await refreshTokens(id, first.oauth.tokens?.access_token))) throw error;
      const again = target();
      return openClient(again.url, again.headers, policy, signal);
    }
  }

  /** Lists the partner's tools; `missing` = tools the entry needs that the partner lacks. */
  async function listTools(open: OpenClient, entry: ConnectorEntry) {
    const defs = await listToolDefinitions(open);
    const wanted = new Set(entry.tools!.map((t) => t.name));
    const tools = defs.filter((d) => wanted.has(d.name)).map(partnerTool);
    const found = new Set(tools.map((t) => t.name));
    return { tools, missing: entry.tools!.filter((t) => !found.has(t.name)).map((t) => t.name) };
  }

  /** Connects with these credentials and lists the tools; throws the problem for the form. */
  async function verify(url: string, headers: Record<string, string>, entry: ConnectorEntry) {
    let open: OpenClient;
    try {
      open = await openClient(url, headers, policy);
    } catch (error) {
      throw problemError(problemOf(error instanceof McpError ? error.failure : 'unreachable'));
    }
    try {
      const found = await listTools(open, entry);
      if (found.missing.length) throw problemError('missing_tools');
      return found.tools;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw problemError(problemOf(error instanceof McpError ? error.failure : 'unreachable'));
    } finally {
      await open.close();
    }
  }

  // ── views ───────────────────────────────────────────────────────────────────────────────

  function view(id: string): ConnectorConnectionView | null {
    const row = getConnection(ctx.db, id);
    const waiting = pending.waiting(id);
    if (!row || row.state === 'disconnected') {
      if (waiting)
        return { state: 'waiting', account: null, keyEnd: null, connectedAt: null, fields: {} };
      return row
        ? { state: 'disconnected', account: null, keyEnd: null, connectedAt: null, fields: {} }
        : null;
    }
    return {
      state: row.state,
      account: row.account,
      keyEnd: row.keyEnd,
      connectedAt: row.connectedAt,
      fields: row.fields,
    };
  }

  const port: ConnectorConnectionsPort = {
    view,
    saved: () =>
      listConnections(ctx.db)
        .filter((row) => row.state !== 'disconnected')
        .map((row) => ({ id: row.connectorId, entry: row.entry })),
  };

  function store(
    id: string,
    entry: ConnectorEntry,
    secret: ConnectionSecret,
    extra: { fields: Record<string, string>; keyEnd: string | null; tools: PartnerTool[] },
  ) {
    saveConnection(
      ctx.db,
      {
        connectorId: id,
        state: 'connected',
        entry,
        secret: sealSecret(secret),
        account: null,
        keyEnd: extra.keyEnd,
        fields: extra.fields,
        tools: extra.tools,
        connectedAt: now(),
      },
      now(),
    );
  }

  /** The credentials of a key, form or open sign-in, checked and verified against the partner. */
  async function checkKeyed(entry: ConnectorEntry, given: Record<string, string>) {
    const auth = entry.auth!;
    if (auth.type === 'none') {
      const url = checkedUrl(entry.mcp!.url, {});
      return {
        secret: { type: 'none' } as ConnectionSecret,
        fields: {},
        keyEnd: null,
        tools: await verify(url, {}, entry),
      };
    }
    if (auth.type !== 'api_key' && auth.type !== 'credentials')
      throw errors.validation('This connector signs in on the partner page');
    const creds = checkCredentials(auth, given);
    const url = checkedUrl(entry.mcp!.url, creds.fields);
    const headers = buildHeaders(auth, { ...creds.fields, ...creds.secret });
    return {
      secret: { type: auth.type, values: creds.secret } as ConnectionSecret,
      fields: creds.fields,
      keyEnd: creds.keyEnd,
      tools: await verify(url, headers, entry),
    };
  }

  function callbackPage(status: number, title: string, message: string): CallbackPage {
    return { status, title, message };
  }

  // ── per-agent settings ──────────────────────────────────────────────────────────────────

  function defaults(entry: ConnectorEntry): ConnectorAgentSettings {
    return {
      settings: Object.fromEntries(
        (entry.settings ?? []).filter((s) => s.default !== undefined).map((s) => [s.id, s.default]),
      ),
      tools: Object.fromEntries(entry.tools!.map((t) => [t.name, t.access === 'read'])),
    };
  }

  /** The agent's settings: stored values of known settings and tools over the entry's defaults. */
  function effectiveSettings(entry: ConnectorEntry, agentId: number): ConnectorAgentSettings {
    const base = defaults(entry);
    const stored = readAgentSettings(ctx.db, entry.id, agentId);
    if (!stored) return base;
    const settingIds = new Set((entry.settings ?? []).map((s) => s.id));
    for (const [key, value] of Object.entries(stored.settings))
      if (settingIds.has(key)) base.settings[key] = value;
    // A switch counts only for the access it was set for: a look-up the list later turns into a
    // write tool starts off again until an admin switches it on as a write tool.
    for (const tool of entry.tools!) {
      const saved = stored.tools[tool.name];
      if (saved && typeof saved.on === 'boolean' && saved.access === tool.access)
        base.tools[tool.name] = saved.on;
    }
    return base;
  }

  const requireAgent = (agentId: number) => {
    const agent = agentById(ctx.db, agentId);
    if (!agent) throw errors.notFound('Agent');
    return agent;
  };

  // ── calls (agent turns and setting choices) ─────────────────────────────────────────────

  /** One tool call, bounded to 10 s. Throws ConnectorCallError with the failure reason. */
  async function callTool(
    open: OpenClient,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Exclude<CallOutcome, { kind: 'failed' }>> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const bound = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let result: unknown;
    try {
      result = await open.client.callTool({ name, arguments: args }, undefined, {
        signal: bound,
        timeout: REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      const failure = error instanceof McpError ? error.failure : null;
      const status = open.probe.lastStatus;
      if (failure === 'unauthorized' || status === 401 || status === 403)
        throw new ConnectorCallError('needs_sign_in');
      if (
        failure === 'url_private' ||
        open.probe.blocked ||
        open.probe.networkError ||
        open.probe.timedOut
      )
        throw new ConnectorCallError('unreachable');
      throw new ConnectorCallError(
        status !== null && status >= 200 && status < 300 ? 'partner_error' : 'unreachable',
      );
    }
    const outcome = interpretResult(result);
    if (outcome.kind === 'failed') throw new ConnectorCallError('partner_error');
    return outcome;
  }

  const service = {
    port,
    policy,
    pending,
    view,

    /** The agent's view for the routes. */
    getAgentSettings(id: string, agentId: number): ConnectorAgentSettings {
      const entry = configEntry(id);
      requireAgent(agentId);
      return effectiveSettings(entry, agentId);
    },

    putAgentSettings(
      id: string,
      agentId: number,
      body: ConnectorAgentSettings,
      actor: { userId: number; ip: string | null },
    ): ConnectorAgentSettings {
      const entry = configEntry(id);
      requireAgent(agentId);
      const parsed = ConnectorAgentSettings.parse(body);
      const defs = new Map((entry.settings ?? []).map((s) => [s.id, s]));
      const tools = new Map(entry.tools!.map((t) => [t.name, t]));
      const settings: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed.settings)) {
        const def = defs.get(key);
        if (!def) throw errors.validation(`${key}: unknown setting`);
        if (value === null) continue;
        settings[key] = checkSettingValue(def, value);
      }
      const switches: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(parsed.tools)) {
        if (!tools.has(key)) throw errors.validation(`${key}: unknown tool`);
        switches[key] = value;
      }
      const before = effectiveSettings(entry, agentId);
      const next: ConnectorAgentSettings = {
        settings: { ...before.settings, ...settings },
        tools: { ...before.tools, ...switches },
      };
      for (const key of Object.keys(parsed.settings))
        if (parsed.settings[key] === null) delete next.settings[key];
      // What the agent works with: defaults for settings set back to null.
      const after = { ...defaults(entry).settings, ...next.settings };
      if (Object.values(next.tools).some(Boolean))
        for (const def of entry.settings ?? [])
          if (def.required && isBlank(after[def.id]))
            throw errors.validation(`${def.id}: required`);
      const changed = [...new Set([...Object.keys(before.settings), ...Object.keys(after)])].filter(
        (key) => JSON.stringify(before.settings[key]) !== JSON.stringify(after[key]),
      );
      const toggled = Object.keys(next.tools).filter(
        (key) => before.tools[key] !== next.tools[key],
      );
      writeAgentSettings(
        ctx.db,
        entry.id,
        agentId,
        {
          settings: next.settings,
          tools: Object.fromEntries(
            entry.tools!.map((t) => [
              t.name,
              { on: next.tools[t.name] === true, access: t.access },
            ]),
          ),
        },
        now(),
      );
      if (changed.length || toggled.length)
        audit(ctx.db, {
          userId: actor.userId,
          action: 'connector.agent_settings',
          ip: actor.ip,
          meta: { connectorId: entry.id, agentId, fields: changed, tools: toggled },
        });
      return effectiveSettings(entry, agentId);
    },

    activity(id: string): ConnectorActivity[] {
      configEntry(id);
      return listActivity(ctx.db, id);
    },

    /** Connect: key, form and open sign-ins at once; OAuth starts a sign-in in a new tab. */
    async connect(
      id: string,
      body: ConnectorConnectBody,
      redirectUri: string,
      actor: { userId: number; ip: string | null },
    ): Promise<ConnectorConnectResult> {
      const entry = listEntry(id);
      if (!entry) throw errors.notFound('Connector');
      const auth = entry.auth!;
      if (auth.type === 'oauth' || auth.type === 'oauth_own_app')
        return service.startSignIn(entry, body.fields, redirectUri, actor);
      const checked = await checkKeyed(entry, body.fields);
      store(id, entry, checked.secret, checked);
      pending.forget(id);
      audit(ctx.db, {
        userId: actor.userId,
        action: 'connector.connect',
        ip: actor.ip,
        meta: { connectorId: id, type: auth.type },
      });
      log.info(
        {
          event: 'connector_connected',
          connector: id,
          type: auth.type,
          tools: checked.tools.length,
        },
        'Partner connected',
      );
      return { authorizationUrl: null, requestId: null, connection: view(id)! };
    },

    async startSignIn(
      entry: ConnectorEntry,
      given: Record<string, string>,
      redirectUri: string,
      actor: { userId: number; ip: string | null },
    ): Promise<ConnectorConnectResult> {
      const auth = entry.auth as Extract<
        ConnectorEntry['auth'],
        { type: 'oauth' | 'oauth_own_app' }
      >;
      const client =
        auth.type === 'oauth_own_app'
          ? {
              client_id: checkSecret(given.clientId, 'client ID'),
              client_secret: checkSecret(given.clientSecret, 'client secret'),
            }
          : auth.clientId
            ? { client_id: auth.clientId }
            : null;
      const url = checkedUrl(entry.mcp!.url, {});
      const data: OAuthState = {
        redirectUrl: redirectUri,
        ...(client ? { client, dynamic: false } : {}),
      };
      pending.forget(entry.id);
      const p = pending.create({
        connectorId: entry.id,
        entry,
        url,
        userId: actor.userId,
        ip: actor.ip,
        data,
      });
      let page: URL | undefined;
      const scope = auth.scopes.join(' ') || undefined;
      const provider = new ConnectorOAuthProvider(p.data, {
        redirectUrl: redirectUri,
        scope,
        interactive: true,
        onAuthorizationUrl: (u) => {
          page = u;
        },
        stateValue: p.state,
        now,
      });
      const probe = new NetProbe();
      try {
        const result = await oauthFlow(provider, {
          serverUrl: url,
          scope,
          fetchFn: guardedFetch(policy, probe),
        });
        if (result !== 'REDIRECT' || !page) throw new Error('no sign-in page');
      } catch {
        pending.delete(p.requestId);
        if (probe.blocked) throw problemError('private_address');
        if (probe.networkError || probe.timedOut) throw problemError('unreachable');
        throw problemError('refused');
      }
      // The admin's browser opens it: https only (loopback in test runs only).
      const pageOk =
        page.protocol === 'https:' ||
        (allowLoopback &&
          connectorUrlProblem(page.href.replace(/^http:/, 'https:'), true) === null);
      if (!pageOk) {
        pending.delete(p.requestId);
        throw problemError('refused');
      }
      log.info(
        { event: 'connector_sign_in_started', connector: entry.id, type: auth.type },
        'Partner sign-in started',
      );
      return { authorizationUrl: page.href, requestId: p.requestId, connection: view(entry.id)! };
    },

    progress(id: string, requestId: string): ConnectorConnectProgress | null {
      const p = pending.get(requestId);
      if (!p || p.connectorId !== id) return null;
      if (p.result.status === 'pending')
        return pending.expired(p)
          ? { status: 'failed', problem: 'expired' }
          : { status: 'pending', problem: null };
      if (p.result.status === 'failed') return { status: 'failed', problem: p.result.problem };
      return { status: 'done', problem: null };
    },

    /** The partner's redirect: one-time `state`, PKCE verifier, code exchange, tools listed, saved. */
    async callback(query: Record<string, unknown>): Promise<CallbackPage> {
      const state = str(query.state, 200);
      const p = state ? pending.takeByState(state) : null;
      if (!p)
        return callbackPage(400, 'Sign-in link expired', 'Start the sign-in again from EzyChat.');
      const failed = (problem: ConnectorProblem, title = 'Sign-in failed') => {
        p.result = { status: 'failed', problem };
        log.info(
          { event: 'connector_sign_in_failed', connector: p.connectorId, problem },
          'Partner sign-in failed',
        );
        return callbackPage(400, title, 'You can close this window and try again from EzyChat.');
      };
      const error = str(query.error, 100);
      if (error)
        return failed(error === 'access_denied' ? 'cancelled' : 'refused', 'Sign-in cancelled');
      const code = str(query.code, 2048);
      if (!code) return failed('refused');
      const auth = p.entry.auth as Extract<
        ConnectorEntry['auth'],
        { type: 'oauth' | 'oauth_own_app' }
      >;
      const scope = auth.scopes.join(' ') || undefined;
      const provider = new ConnectorOAuthProvider(p.data, {
        redirectUrl: p.data.redirectUrl ?? '',
        scope,
        interactive: false,
        stateValue: p.state,
        now,
      });
      const probe = new NetProbe();
      try {
        const result = await oauthFlow(provider, {
          serverUrl: p.url,
          authorizationCode: code,
          scope,
          fetchFn: guardedFetch(policy, probe),
        });
        if (result !== 'AUTHORIZED' || !p.data.tokens) throw new Error('not authorized');
      } catch {
        if (probe.blocked) return failed('private_address');
        if (probe.networkError || probe.timedOut) return failed('unreachable');
        return failed('refused');
      }
      delete p.data.codeVerifier;
      // Disconnect or a new sign-in while the partner answered: this grant is not wanted any more.
      const discarded = async () => {
        if (pending.get(p.requestId) === p) return false;
        p.result = { status: 'failed', problem: 'cancelled' };
        await revoke(p.data).catch(() => undefined);
        log.info(
          { event: 'connector_sign_in_discarded', connector: p.connectorId },
          'Partner sign-in discarded',
        );
        return true;
      };
      if (await discarded())
        return callbackPage(
          400,
          'Sign-in cancelled',
          'You can close this window and try again from EzyChat.',
        );
      let tools: PartnerTool[];
      try {
        tools = await verify(
          p.url,
          { Authorization: `Bearer ${p.data.tokens.access_token}` },
          p.entry,
        );
      } catch (e) {
        return failed((e as HttpError).code as ConnectorProblem);
      }
      if (await discarded())
        return callbackPage(
          400,
          'Sign-in cancelled',
          'You can close this window and try again from EzyChat.',
        );
      store(
        p.connectorId,
        p.entry,
        { type: auth.type, oauth: p.data },
        { fields: {}, keyEnd: null, tools },
      );
      p.result = { status: 'done' };
      audit(ctx.db, {
        userId: p.userId,
        action: 'connector.connect',
        ip: p.ip,
        meta: { connectorId: p.connectorId, type: auth.type },
      });
      log.info(
        {
          event: 'connector_connected',
          connector: p.connectorId,
          type: auth.type,
          tools: tools.length,
        },
        'Partner connected',
      );
      return callbackPage(
        200,
        `${p.entry.name} connected`,
        'You can close this window and return to EzyChat.',
      );
    },

    /**
     * Test connection: lists the partner's tools. With `fields` (key and form sign-ins, before
     * Save) it tests them without saving; else it tests the saved connection and records its state.
     */
    async test(id: string, given: Record<string, string>): Promise<ConnectorTestResult> {
      if (Object.keys(given).length) {
        const entry = listEntry(id);
        if (!entry) throw errors.notFound('Connector');
        try {
          const checked = await checkKeyed(entry, given);
          return { ok: true, tools: checked.tools.map((t) => t.name), problem: null };
        } catch (error) {
          if (error instanceof HttpError && error.code in MESSAGES)
            return { ok: false, tools: [], problem: error.code as ConnectorProblem };
          throw error;
        }
      }
      const row = liveRow(id);
      if (!row) throw errors.notFound('Connection');
      const entry = runtimeEntry(row);
      let open: OpenClient | null = null;
      try {
        open = await openRow(row);
        const found = await listTools(open, entry);
        setTools(ctx.db, id, found.tools, now());
        setState(ctx.db, id, 'connected', now());
        log.info(
          { event: 'connector_test', connector: id, ok: !found.missing.length },
          'Partner tested',
        );
        return found.missing.length
          ? { ok: false, tools: found.tools.map((t) => t.name), problem: 'missing_tools' }
          : { ok: true, tools: found.tools.map((t) => t.name), problem: null };
      } catch (error) {
        const failure = error instanceof McpError ? error.failure : 'unreachable';
        setState(ctx.db, id, stateOf(failure), now());
        log.info(
          { event: 'connector_test', connector: id, ok: false, state: stateOf(failure) },
          'Partner tested',
        );
        return { ok: false, tools: [], problem: problemOf(failure) };
      } finally {
        await open?.close();
      }
    },

    /** Disconnect: revokes an OAuth grant when the partner offers it, deletes the secrets. */
    async disconnect(id: string, actor: { userId: number; ip: string | null }) {
      // A sign-in still waiting for the partner is cancelled too (its callback is then discarded).
      pending.forget(id);
      const row = getConnection(ctx.db, id);
      if (!row) throw errors.notFound('Connection');
      const secret = readSecret(row);
      clearConnection(ctx.db, id, now());
      if (secret && (secret.type === 'oauth' || secret.type === 'oauth_own_app'))
        await revoke(secret.oauth).catch(() => undefined);
      audit(ctx.db, {
        userId: actor.userId,
        action: 'connector.disconnect',
        ip: actor.ip,
        meta: { connectorId: id },
      });
      log.info({ event: 'connector_disconnected', connector: id }, 'Partner disconnected');
      return view(id)!;
    },

    /** calendarPicker choices: the setting's `from` read tool, called with no arguments. */
    async choices(
      id: string,
      settingId: string,
    ): Promise<{ options: Array<{ value: string; label: string }> }> {
      const row = liveRow(id);
      if (!row) throw errors.notFound('Connection');
      const entry = runtimeEntry(row);
      const def = (entry.settings ?? []).find((s) => s.id === settingId);
      const from = def?.type === 'calendarPicker' ? def.from : undefined;
      if (!from || !entry.tools!.some((t) => t.name === from && t.access === 'read'))
        throw errors.notFound('Setting');
      let open: OpenClient;
      try {
        open = await openRow(row);
      } catch (error) {
        throw problemError(problemOf(error instanceof McpError ? error.failure : 'unreachable'));
      }
      try {
        const outcome = await callTool(open, from, {});
        return { options: outcome.kind === 'ok' ? choicesOf(outcome.structured) : [] };
      } catch (error) {
        if (error instanceof ConnectorCallError)
          throw problemError(error.reason === 'needs_sign_in' ? 'refused' : 'unreachable');
        throw error;
      } finally {
        await open.close();
      }
    },

    // ── for the AI bridge (tools.ts) ──────────────────────────────────────────────────────

    timeZone(): string {
      return resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null));
    },

    /** Every connected connector that offers this agent at least one enabled tool. */
    turnConnectors(agentId: number): TurnConnector[] {
      if (!agentById(ctx.db, agentId)) return [];
      const out: TurnConnector[] = [];
      for (const row of listConnections(ctx.db)) {
        if (row.state === 'disconnected' || !row.secret) continue;
        const entry = runtimeEntry(row);
        const effective = effectiveSettings(entry, agentId);
        const partner = new Map(row.tools.map((t) => [t.name, t]));
        const tools = entry
          .tools!.filter((def) => effective.tools[def.name] && partner.get(def.name)?.inputSchema)
          .map((def) => ({ def, partner: partner.get(def.name)! }));
        if (tools.length) out.push({ row, entry, tools, settings: effective.settings });
      }
      return out;
    },

    /** True when a connected connector gives this agent an enabled read tool. */
    lookupsAvailable(agentId: number | null | undefined): boolean {
      if (agentId === undefined || agentId === null) return false;
      return service
        .turnConnectors(agentId)
        .some((c) => c.tools.some((t) => t.def.access === 'read'));
    },

    openRow,
    callTool,

    markState(id: string, state: ConnectionState) {
      const row = getConnection(ctx.db, id);
      if (row && row.state !== 'disconnected' && row.state !== state) {
        setState(ctx.db, id, state, now());
        log.info({ event: 'connector_state', connector: id, state }, 'Partner connection state');
      }
    },

    addActivity(row: {
      connectorId: string;
      kind: ConnectorActivity['kind'];
      agentId: number | null;
      chatJid: string | null;
      tool: string;
      reason?: ActivityReason | null;
    }) {
      addActivity(ctx.db, row, now());
    },

    recordValues(id: string, chatJid: string, tool: string, values: readonly string[]) {
      if (values.length) recordValues(ctx.db, id, chatJid, tool, values, now());
    },

    /** Reserves a call (limits, confirmFirst consent); returns the reservation to release on failure. */
    recordCall(
      id: string,
      tool: string,
      chatJid: string | null,
      consentMessageId: string | null = null,
    ) {
      return recordCall(ctx.db, id, tool, chatJid, now(), consentMessageId);
    },

    releaseCall(reservation: number) {
      releaseCall(ctx.db, reservation);
    },

    customerTexts: (chatJid: string) => customerTexts(ctx.db, chatJid),

    /** The saved contact's name, email and phone numbers (for `fromCustomer`). */
    savedContact(chatJid: string): string[] {
      const chat = getChats(ctx).get(chatJid);
      const profile = ctx.services.customers?.profile(chatJid).profile ?? null;
      const whatsapp =
        chat?.phone ?? (chat?.waJid.endsWith('@s.whatsapp.net') ? chat.waJid.split('@')[0]! : null);
      return [
        profile?.name,
        chat?.name,
        chat?.whatsappName,
        profile?.email,
        profile?.otherPhone,
        whatsapp,
      ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    },

    now,

    shutdown() {
      pending.clear();
      refreshes.clear();
    },
  };

  /** RFC 7009 revocation when the partner's metadata lists an endpoint (best effort, 10 s). */
  async function revoke(oauth: OAuthState): Promise<void> {
    const endpoint = (
      oauth.discovery?.authorizationServerMetadata as { revocation_endpoint?: unknown } | undefined
    )?.revocation_endpoint;
    const token = oauth.tokens?.refresh_token ?? oauth.tokens?.access_token;
    if (typeof endpoint !== 'string' || !token || !oauth.client) return;
    const form = new URLSearchParams({
      token,
      token_type_hint: oauth.tokens?.refresh_token ? 'refresh_token' : 'access_token',
      client_id: oauth.client.client_id,
    });
    if (oauth.client.client_secret) form.set('client_secret', oauth.client.client_secret);
    const res = await guardedFetch(policy)(endpoint, { method: 'POST', body: form });
    await res.body?.cancel();
  }

  return service;
}

/** Why a partner call failed: the turn hands over and Activity shows the reason. */
export class ConnectorCallError extends Error {
  constructor(readonly reason: 'unreachable' | 'partner_error' | 'needs_sign_in') {
    super(reason);
    this.name = 'ConnectorCallError';
  }
}

/** Options of a calendarPicker from a read tool's result: the first list it holds. */
export function choicesOf(structured: unknown): Array<{ value: string; label: string }> {
  const list = Array.isArray(structured)
    ? structured
    : structured && typeof structured === 'object'
      ? Object.values(structured).find(Array.isArray)
      : undefined;
  if (!Array.isArray(list)) return [];
  const text = (v: unknown) =>
    typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 200) : '';
  const options: Array<{ value: string; label: string }> = [];
  for (const item of list) {
    if (options.length >= MAX_CHOICES) break;
    if (typeof item === 'string' || typeof item === 'number') {
      const value = text(item);
      if (value) options.push({ value, label: value });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const value = text(o.id) || text(o.value) || text(o.name);
    const label = text(o.name) || text(o.label) || text(o.title) || text(o.summary) || value;
    if (value) options.push({ value, label });
  }
  return options;
}

export type ConnectorMcpService = ReturnType<typeof createConnectorMcpService>;

/** Partner (MCP) connections from the connector list. */
export function initConnectorMcp(ctx: AppContext, options?: ConnectorMcpOptions) {
  const service = createConnectorMcpService(ctx, options);
  ctx.services.connectorMcp = service;
  ctx.services.connectorConnections = service.port;
}

export function getConnectorMcp(ctx: AppContext): ConnectorMcpService {
  const service = ctx.services.connectorMcp;
  if (!service) throw new Error('Connector MCP service not initialised');
  return service;
}
