import { z } from 'zod';

/**
 * The connector list (design: docs/features/connector-list/design.md). The public repo
 * anchorsprint/ezychat-connectors builds one signed JSON list from its connector folders and
 * publishes it with the icons to dl.ezychat.ai/connectors/; the server downloads it at start and
 * when an admin opens Admin → Connectors, checks it, and keeps a local copy. The list is public:
 * never a secret in it. An app shows an entry only if it supports the entry's `schemaVersion` and
 * its own version is at least `minAppVersion`.
 */

/** List file formats this app can read. */
export const CONNECTOR_LIST_FORMAT = 1;
/** Entry schema versions this app can run. A newer entry is hidden (schemaVersion rule). */
export const SUPPORTED_CONNECTOR_SCHEMA_VERSIONS: readonly number[] = [1];

export const CONNECTOR_LANGUAGES = ['en', 'ms', 'zh-CN'] as const;
export type ConnectorLanguage = (typeof CONNECTOR_LANGUAGES)[number];

const line = (max: number) => z.string().trim().min(1).max(max);
/** A text in English plus optional Malay and Chinese (English is the fallback). */
export const ConnectorTexts = (max: number) =>
  z.object({ en: line(max), ms: line(max).optional(), 'zh-CN': line(max).optional() });
export type ConnectorTexts = { en: string; ms?: string; 'zh-CN'?: string };

/** The text of `texts` in `language` (its base language, then English). */
export function connectorText(texts: ConnectorTexts | undefined, language: string): string {
  if (!texts) return '';
  if (language in texts) return (texts as Record<string, string>)[language] ?? texts.en;
  const base = language.split('-')[0];
  if (base === 'zh') return texts['zh-CN'] ?? texts.en;
  if (base === 'ms') return texts.ms ?? texts.en;
  return texts.en;
}

export const ConnectorId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/);
const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/);
const HttpsUrl = z
  .string()
  .max(500)
  .refine((value) => {
    try {
      return new URL(value.replace(/\{[a-zA-Z][a-zA-Z0-9]*\}/g, 'x')).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an https address');
/** A JSON argument path of a tool call, e.g. `start` or `attendee.email`. */
const ArgPath = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/);
const SettingId = z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/);

/**
 * Checks the core runs before it calls a partner's tool (a list entry can only add checks, never
 * remove the core rules: write tools start off, Try it never runs them, nothing is undone).
 */
export const ConnectorGuards = z.object({
  /** Runs only when the customer wrote after the AI's proposal. */
  confirmFirst: z.boolean().optional(),
  /** Argument → read tool: the value must be one that tool returned in this chat (24 h). */
  valueFrom: z.record(ArgPath, z.string().min(1).max(64)).optional(),
  /** Arguments that must come from the saved contact or the customer's own messages. */
  fromCustomer: z.array(ArgPath).max(10).optional(),
  /** Argument → setting: an ISO time must fit a `timeRange` / `days` setting of the agent. */
  within: z.record(ArgPath, SettingId).optional(),
  limits: z
    .object({
      perChat: z.number().int().min(1).max(100).optional(),
      perDay: z.number().int().min(1).max(10_000).optional(),
    })
    .optional(),
});
export type ConnectorGuards = z.infer<typeof ConnectorGuards>;

export const ConnectorTool = z.object({
  /** The MCP tool name on the partner's server; any tool not listed is never offered. */
  name: z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/),
  title: ConnectorTexts(60),
  description: ConnectorTexts(400),
  /** Extra instructions for the AI for this tool (skill text). */
  instructions: ConnectorTexts(2000).optional(),
  access: z.enum(['read', 'write']),
  guards: ConnectorGuards.optional(),
});
export type ConnectorTool = z.infer<typeof ConnectorTool>;

export const ConnectorSettingType = z.enum([
  'text',
  'number',
  'select',
  'toggle',
  'days',
  'timeRange',
  'calendarPicker',
]);
export const ConnectorSetting = z.object({
  id: SettingId,
  type: ConnectorSettingType,
  label: ConnectorTexts(80),
  hint: ConnectorTexts(240).optional(),
  options: z
    .array(z.object({ value: z.string().min(1).max(80), label: ConnectorTexts(80) }))
    .max(30)
    .optional(),
  default: z.unknown().optional(),
  /** calendarPicker: the read tool whose result lists the choices. */
  from: z.string().max(64).optional(),
  required: z.boolean().optional(),
});
export type ConnectorSetting = z.infer<typeof ConnectorSetting>;

const HeaderName = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
/** A header value template: `{key}`, `{fieldId}` or `{a:b}` (Basic of two fields). */
const HeaderTemplate = z.string().min(1).max(300);
const CredentialField = z.object({
  id: SettingId,
  label: ConnectorTexts(80),
  hint: ConnectorTexts(240).optional(),
  /** Secret fields are stored encrypted and never shown again; others may fill `mcp.url`. */
  secret: z.boolean(),
});

/** Sign-in types (owner 2026-10-27): never a secret in the list. */
export const ConnectorAuth = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('oauth'),
    /** A public client ID; without it the app registers itself (RFC 7591). Never a secret. */
    clientId: z.string().max(300).optional(),
    scopes: z.array(z.string().min(1).max(300)).max(30).default([]),
  }),
  z.object({
    type: z.literal('oauth_own_app'),
    scopes: z.array(z.string().min(1).max(300)).max(30).default([]),
    help: z.string().url().optional(),
  }),
  z.object({
    type: z.literal('api_key'),
    label: ConnectorTexts(80),
    help: z.string().url().optional(),
    header: z
      .object({ name: HeaderName, value: HeaderTemplate })
      .default({ name: 'Authorization', value: 'Bearer {key}' }),
  }),
  z.object({
    type: z.literal('credentials'),
    fields: z.array(CredentialField).min(1).max(6),
    headers: z
      .array(z.object({ name: HeaderName, value: HeaderTemplate }))
      .min(1)
      .max(6),
    help: z.string().url().optional(),
  }),
  z.object({ type: z.literal('none') }),
]);
export type ConnectorAuth = z.infer<typeof ConnectorAuth>;
export type ConnectorAuthType = ConnectorAuth['type'];

export const ConnectorIcon = z.object({
  /** File name under icons/ next to the list. */
  file: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}\.(svg|png)$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z
    .number()
    .int()
    .min(1)
    .max(256 * 1024),
});
export type ConnectorIcon = z.infer<typeof ConnectorIcon>;

export const ConnectorCategory = z.enum([
  'calendar',
  'accounting',
  'crm',
  'spreadsheets',
  'payments',
  'online_shop',
  'custom',
  'other',
]);

/** One entry, schemaVersion 1. */
export const ConnectorEntry = z
  .object({
    id: ConnectorId,
    schemaVersion: z.literal(1),
    minAppVersion: SemVer,
    kind: z.enum(['mcp', 'builtin', 'coming_soon']),
    editions: z.array(z.enum(['lite', 'enterprise'])).min(1),
    /** builtin: which connector of the app this entry describes (e.g. google-calendar). */
    builtinId: z.string().max(64).optional(),
    name: line(60),
    summary: ConnectorTexts(160),
    description: ConnectorTexts(1200),
    category: ConnectorCategory,
    icon: ConnectorIcon.optional(),
    publisher: line(80).optional(),
    homepage: z.string().url().optional(),
    /** Shown before Connect: who receives which data. */
    privacy: ConnectorTexts(400).optional(),
    mcp: z.object({ url: HttpsUrl }).optional(),
    auth: ConnectorAuth.optional(),
    tools: z.array(ConnectorTool).max(30).optional(),
    /** Instructions for the AI for the whole connector (data, never above the core rules). */
    skill: ConnectorTexts(6000).optional(),
    settings: z.array(ConnectorSetting).max(12).optional(),
    /** coming_soon: the ready message of Vote for this connector. */
    vote: ConnectorTexts(300).optional(),
    /**
     * `beta`: the app shows a Beta badge on the card and the page (e.g. while Google reviews the
     * sign-in app). Removed from the list, the badge goes without an app update.
     */
    stage: z.enum(['beta']).optional(),
    /** A short note on the connector page above Connect (e.g. the warning a sign-in page shows). */
    notice: ConnectorTexts(400).optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.kind === 'mcp' && (!entry.mcp || !entry.auth || !entry.tools?.length))
      ctx.addIssue({ code: 'custom', message: 'mcp entries need mcp, auth and tools' });
    if (entry.kind === 'builtin' && !entry.builtinId)
      ctx.addIssue({ code: 'custom', message: 'builtin entries need builtinId' });
    const names = new Set(entry.tools?.map((tool) => tool.name));
    for (const tool of entry.tools ?? [])
      for (const from of Object.values(tool.guards?.valueFrom ?? {}))
        if (!names.has(from) || entry.tools?.find((t) => t.name === from)?.access !== 'read')
          ctx.addIssue({ code: 'custom', message: `valueFrom ${from} must be a read tool` });
    const settingIds = new Set(entry.settings?.map((setting) => setting.id));
    for (const tool of entry.tools ?? [])
      for (const setting of Object.values(tool.guards?.within ?? {}))
        if (!settingIds.has(setting))
          ctx.addIssue({ code: 'custom', message: `within ${setting} must be a setting` });
  });
export type ConnectorEntry = z.infer<typeof ConnectorEntry>;

/** The list file. Entries are read one by one: an unknown schemaVersion hides only that entry. */
export const ConnectorListFile = z.object({
  format: z.literal(CONNECTOR_LIST_FORMAT),
  generatedAt: z.string().datetime(),
  /** Increases on every publish; the app never accepts a lower one (no roll-back). */
  sequence: z.number().int().min(1),
  entries: z.array(z.unknown()).max(500),
});
export type ConnectorListFile = z.infer<typeof ConnectorListFile>;

/** "a.b.c" >= "x.y.z". */
export function versionAtLeast(have: string, need: string): boolean {
  const a = have.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = need.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/**
 * How this app may show an entry: `hidden` (unknown schema version), `needsUpdate` (newer
 * minAppVersion), `enterprise` (not in this edition), `ok`.
 */
export type ConnectorFit = 'hidden' | 'needsUpdate' | 'enterprise' | 'ok';
export function connectorFit(
  entry: { schemaVersion: number; minAppVersion: string; editions: string[] },
  app: { version: string; edition: string },
): ConnectorFit {
  if (!SUPPORTED_CONNECTOR_SCHEMA_VERSIONS.includes(entry.schemaVersion)) return 'hidden';
  if (!versionAtLeast(app.version, entry.minAppVersion)) return 'needsUpdate';
  if (!entry.editions.includes(app.edition === 'lite' ? 'lite' : 'enterprise')) return 'enterprise';
  return 'ok';
}

// ── REST views (admins) ────────────────────────────────────────────────────────────────────

/**
 * `loaded`: the latest list passed its checks; `offline`: download failed, the last good copy is
 * used; `rejected`: a list failed its checks, the last good copy is used; `builtin`: no list was
 * ever saved, the copy shipped in the app is used.
 */
export const ConnectorListState = z.enum(['loaded', 'offline', 'rejected', 'builtin']);
export type ConnectorListState = z.infer<typeof ConnectorListState>;

export const ConnectorListStatus = z.object({
  state: ConnectorListState,
  /** When the copy in use was published / last checked (ms). */
  generatedAt: z.string().nullable(),
  sequence: z.number().int().nullable(),
  checkedAt: z.number().int().nullable(),
  appVersion: z.string(),
  /** Entries hidden because this app does not know their schema version. */
  hidden: z.number().int(),
});
export type ConnectorListStatus = z.infer<typeof ConnectorListStatus>;

/** A partner (MCP) connection as the browser sees it: never a token, key or secret. */
export const ConnectorConnectionState = z.enum([
  'disconnected',
  'waiting',
  'connected',
  'needs_sign_in',
  'unreachable',
]);
export type ConnectorConnectionState = z.infer<typeof ConnectorConnectionState>;

export const ConnectorConnectionView = z.object({
  state: ConnectorConnectionState,
  /** The partner account (OAuth) when the server tells it. */
  account: z.string().nullable(),
  /** Last 4 characters of the key or first secret field, for display. */
  keyEnd: z.string().nullable(),
  connectedAt: z.number().int().nullable(),
  /** Non-secret credential fields (e.g. tenant) as entered. */
  fields: z.record(z.string(), z.string()).default({}),
});
export type ConnectorConnectionView = z.infer<typeof ConnectorConnectionView>;

export const GalleryConnector = z.object({
  entry: ConnectorEntry,
  fit: z.enum(['needsUpdate', 'enterprise', 'ok']),
  /** Connected but no longer in the list: kept from the copy saved at connect time. */
  delisted: z.boolean(),
  connection: ConnectorConnectionView.nullable(),
});
export type GalleryConnector = z.infer<typeof GalleryConnector>;

/** `GET /api/connectors/list` (admins). */
export const ConnectorGallery = z.object({
  status: ConnectorListStatus,
  connectors: z.array(GalleryConnector),
});
export type ConnectorGallery = z.infer<typeof ConnectorGallery>;

/** `POST /api/connectors/mcp/:id/connect` body for the key and form sign-ins. */
export const ConnectorConnectBody = z.object({
  /** api_key: { key }; credentials: the declared fields; oauth_own_app: { clientId, clientSecret }. */
  fields: z.record(z.string(), z.string().max(4000)).default({}),
});
export type ConnectorConnectBody = z.infer<typeof ConnectorConnectBody>;

export const ConnectorConnectResult = z.object({
  /** OAuth: open this address in a new tab, then poll `GET …/connect/:requestId`. */
  authorizationUrl: z.string().url().nullable(),
  requestId: z.string().nullable(),
  connection: ConnectorConnectionView,
});
export type ConnectorConnectResult = z.infer<typeof ConnectorConnectResult>;

export const ConnectorProblem = z.enum([
  'refused',
  'unreachable',
  'cancelled',
  'expired',
  'not_https',
  'private_address',
  'missing_tools',
]);
export type ConnectorProblem = z.infer<typeof ConnectorProblem>;

export const ConnectorConnectProgress = z.object({
  status: z.enum(['pending', 'done', 'failed']),
  problem: ConnectorProblem.nullable(),
});
export type ConnectorConnectProgress = z.infer<typeof ConnectorConnectProgress>;

/** `GET`/`PUT /api/connectors/mcp/:id/agents/:agentId`: settings values and tool switches. */
export const ConnectorAgentSettings = z.object({
  settings: z.record(z.string(), z.unknown()).default({}),
  tools: z.record(z.string(), z.boolean()).default({}),
});
export type ConnectorAgentSettings = z.infer<typeof ConnectorAgentSettings>;

export const ConnectorActivityReason = z.enum([
  'confirm_first',
  'value_from',
  'from_customer',
  'within',
  'limit',
  'unreachable',
  'partner_error',
  'needs_sign_in',
]);
export const ConnectorActivity = z.object({
  id: z.number().int(),
  at: z.number().int(),
  kind: z.enum(['checked', 'done', 'refused', 'failed']),
  agentName: z.string(),
  customer: z.string(),
  tool: z.string(),
  reason: ConnectorActivityReason.nullable(),
});
export type ConnectorActivity = z.infer<typeof ConnectorActivity>;
export const ConnectorActivityList = z.object({ activity: z.array(ConnectorActivity) });

/** `POST /connectors/mcp/:id/test`: whether the server answered, the names of its tools, and why not. */
export const ConnectorTestResult = z.object({
  ok: z.boolean(),
  tools: z.array(z.string()),
  problem: ConnectorProblem.nullable(),
});
export type ConnectorTestResult = z.infer<typeof ConnectorTestResult>;

/** `GET /connectors/mcp/:id/choices/:settingId`: the choices of a picker setting (e.g. calendars). */
export const ConnectorChoices = z.object({
  options: z.array(z.object({ value: z.string(), label: z.string() })),
});
export type ConnectorChoices = z.infer<typeof ConnectorChoices>;
