import { z } from 'zod';

/**
 * Zoho CRM connector (core; design docs/features/zoho-crm/design.md). One Zoho account per
 * install: the AI agent finds the customer by WhatsApp number in Contacts and Leads and, when an
 * admin allows it, adds a new enquiry as a Lead. Teammates see the chat's record in the customer
 * panel.
 */

/**
 * Zoho's data centres: the domain suffix of the account's Zoho site (`zoho.<region>`, Canada is
 * `zohocloud.ca`). The account signs in and calls the API in its own data centre.
 */
export const ZOHO_REGIONS = ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa'] as const;
export const ZohoRegion = z.enum(ZOHO_REGIONS);
export type ZohoRegion = z.infer<typeof ZohoRegion>;

/** `accounts.zoho.<region>` (Canada: `accounts.zohocloud.ca`). */
export function zohoAccountsHost(region: ZohoRegion): string {
  return region === 'ca' ? 'accounts.zohocloud.ca' : `accounts.zoho.${region}`;
}

/** The Zoho CRM web app of a data centre (`crm.zoho.<region>`, Canada `crm.zohocloud.ca`). */
export function zohoCrmHost(region: ZohoRegion): string {
  return region === 'ca' ? 'crm.zohocloud.ca' : `crm.zoho.${region}`;
}

/** As Google Calendar: `not_configured` = this build has no Zoho app (no client id). */
export const ZohoCrmState = z.enum([
  'not_configured',
  'disconnected',
  'connected',
  'expired',
  'unavailable',
]);
export type ZohoCrmState = z.infer<typeof ZohoCrmState>;

export const ZohoCrmUser = z.object({ id: z.string(), name: z.string() });
export type ZohoCrmUser = z.infer<typeof ZohoCrmUser>;

/** `GET /api/connectors/zoho-crm` (admins). Tokens are never sent to the browser. */
export const ZohoCrmStatus = z.object({
  state: ZohoCrmState,
  region: ZohoRegion.nullable(),
  /** The signed-in Zoho user's email. */
  account: z.string().nullable(),
  /** The organisation's name in Zoho CRM. */
  org: z.string().nullable(),
  /** Active Zoho CRM users (lead owner choice). */
  users: z.array(ZohoCrmUser),
  /** Opens the organisation's Zoho CRM in the browser; null when not connected. */
  crmUrl: z.string().url().nullable(),
  connectedAt: z.number().int().nullable(),
  problemSince: z.number().int().nullable(),
});
export type ZohoCrmStatus = z.infer<typeof ZohoCrmStatus>;

/** `POST /api/connectors/zoho-crm/connect` {region}: open `authorizationUrl` in a new window. */
export const ZohoCrmConnectBody = z.object({ region: ZohoRegion });
export type ZohoCrmConnectBody = z.infer<typeof ZohoCrmConnectBody>;

export const ZohoCrmConnectStart = z.object({
  requestId: z.string(),
  authorizationUrl: z.string().url(),
});
export type ZohoCrmConnectStart = z.infer<typeof ZohoCrmConnectStart>;

export const ZohoCrmConnectProgress = z.object({
  status: z.enum(['pending', 'done', 'failed']),
  error: z.enum(['denied', 'expired', 'error']).nullable(),
});
export type ZohoCrmConnectProgress = z.infer<typeof ZohoCrmConnectProgress>;

export const ZOHO_LEAD_SOURCE_CHARACTERS = 40;

/** Per AI agent: `GET`/`PUT /api/connectors/zoho-crm/agents/:agentId` (admins). */
export const ZohoCrmAgentSettings = z
  .object({
    /** Find the customer: look up the chat's WhatsApp number before answering. */
    find: z.boolean(),
    /** Add new leads: add one Lead for a number in neither Contacts nor Leads (needs `find`). */
    addLeads: z.boolean(),
    /** Lead owner: a Zoho user id, or null = the signed-in user (Zoho's own rules may change it). */
    ownerId: z.string().min(1).max(40).nullable(),
    leadSource: z.string().trim().min(1).max(ZOHO_LEAD_SOURCE_CHARACTERS),
    /** Write a one-line summary of the request into the lead's Description. */
    includeRequest: z.boolean(),
  })
  .refine((s) => s.find || !s.addLeads, { path: ['addLeads'], message: 'addLeads needs find' });
export type ZohoCrmAgentSettings = z.infer<typeof ZohoCrmAgentSettings>;

export const DEFAULT_ZOHO_CRM_SETTINGS: ZohoCrmAgentSettings = {
  find: true,
  addLeads: false,
  ownerId: null,
  leadSource: 'WhatsApp',
  includeRequest: true,
};

export const ZohoCrmModule = z.enum(['Contacts', 'Leads']);
export type ZohoCrmModule = z.infer<typeof ZohoCrmModule>;

/** One line of the Activity tab: who and when, never chat text. */
export const ZohoCrmActivityKind = z.enum([
  'found',
  'not_found',
  'added',
  'added_by_team',
  'not_added',
  'failed',
]);
export type ZohoCrmActivityKind = z.infer<typeof ZohoCrmActivityKind>;
export const ZohoCrmNotAddedReason = z.enum(['exists', 'no_name', 'unavailable']);
export type ZohoCrmNotAddedReason = z.infer<typeof ZohoCrmNotAddedReason>;
export const ZohoCrmActivity = z.object({
  id: z.number().int(),
  at: z.number().int(),
  kind: ZohoCrmActivityKind,
  agentId: z.number().int().nullable(),
  /** The AI agent's name, or the teammate's for `added_by_team`. */
  actorName: z.string(),
  chatJid: z.string().nullable(),
  customer: z.string(),
  module: ZohoCrmModule.nullable(),
  reason: ZohoCrmNotAddedReason.nullable(),
});
export type ZohoCrmActivity = z.infer<typeof ZohoCrmActivity>;

/** `GET /api/connectors/zoho-crm/activity` (admins): newest first, at most 50. */
export const ZohoCrmActivityList = z.object({ activity: z.array(ZohoCrmActivity) });
export type ZohoCrmActivityList = z.infer<typeof ZohoCrmActivityList>;

/** A Contact or Lead as the customer panel shows it. */
export const ZohoCrmRecord = z.object({
  module: ZohoCrmModule,
  id: z.string(),
  name: z.string(),
  company: z.string().nullable(),
  owner: z.string().nullable(),
  /** Leads: Lead Status. */
  status: z.string().nullable(),
  /** A lead EzyChat added: by the AI or by a teammate; null for other records. */
  addedBy: z.enum(['ai', 'team']).nullable(),
  /** The one-line request summary EzyChat wrote, when it added the lead. */
  request: z.string().nullable(),
  /** Opens the record in Zoho CRM. */
  url: z.string().url().nullable(),
});
export type ZohoCrmRecord = z.infer<typeof ZohoCrmRecord>;

/**
 * `GET /api/chats/:jid/zoho-crm` (anyone who can open the chat; direct chats): the chat's record.
 * `state` other than `connected` hides or greys the card; `record` null = not in Zoho CRM.
 */
export const ZohoCrmChatRecord = z.object({
  state: ZohoCrmState,
  record: ZohoCrmRecord.nullable(),
});
export type ZohoCrmChatRecord = z.infer<typeof ZohoCrmChatRecord>;

/** The Zoho CRM part of an `ai_tool_used` chat event ("AI added a lead · Zoho CRM"). */
export const AiToolCrmDetail = z.object({
  action: z.enum(['found', 'not_found', 'lead_added']),
});
export type AiToolCrmDetail = z.infer<typeof AiToolCrmDetail>;
