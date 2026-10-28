import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../packages/server/src/context.js';
import { requireAdmin, requireUser } from '../../../../packages/server/src/auth/guards.js';
import { parse } from '../../../../packages/server/src/http/errors.js';

/**
 * Proposed (zoho-crm): stand-in for the built-in Zoho CRM connector. Nothing calls Zoho: "Sign in with
 * Zoho" is a mock consent dialog, the CRM records are canned and keyed by the WhatsApp number.
 * Production plan (../design.md): `/api/connectors/zoho-crm/*` (admins), per-agent settings in
 * `zoho_crm_agent_settings`, the AI tools `find_crm_customer` and `add_crm_lead`, and the customer
 * panel read `GET /api/chats/:jid/zoho-crm` (any user with inbox access).
 */
export type MockZohoState = 'disconnected' | 'connected' | 'expired' | 'unavailable';

/** Zoho data centres (the account's region decides the sign-in and API hosts). */
export const ZOHO_REGIONS = ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa'] as const;
export type ZohoRegion = (typeof ZOHO_REGIONS)[number];

const AgentCrm = z.object({
  /** "Find the customer": look up the chat's number in Contacts and Leads before answering. */
  find: z.boolean(),
  /** "Add new leads": add a Lead when the number is in neither module. Off by default. */
  addLeads: z.boolean(),
  /** Lead owner: 'default' = the signed-in Zoho user (Zoho's assignment rules may change it). */
  ownerId: z.string().min(1).max(40),
  /** Lead Source written on new leads. */
  leadSource: z.string().trim().min(1).max(40),
  /** Write a one-line summary of what the customer asked into the lead's Description. */
  includeRequest: z.boolean(),
});
export type MockAgentCrm = z.infer<typeof AgentCrm>;

export interface MockCrmRecord {
  module: 'Contacts' | 'Leads';
  id: string;
  name: string;
  company: string | null;
  owner: string;
  /** Leads only: Lead Status. */
  status: string | null;
  /** Description on a lead the AI added (a one-line summary, never chat text). */
  request: string | null;
  addedBy: 'ai' | 'team' | null;
  url: string;
}

/** One line of the connector's Activity tab (never the chat text). */
export interface MockCrmActivity {
  at: number;
  kind: 'found' | 'not_found' | 'added' | 'added_by_team' | 'not_added';
  agent: string;
  customer: string;
  module?: 'Contacts' | 'Leads';
  /** not_added: why (already in Zoho CRM, no name yet, Zoho unavailable). */
  reason?: 'exists' | 'no_name' | 'unavailable';
}

export interface MockZohoCrmState {
  state: MockZohoState;
  region: ZohoRegion | null;
  account: string | null;
  org: string | null;
  users: Array<{ id: string; name: string }>;
  agents: Record<string, MockAgentCrm>;
  activity: MockCrmActivity[];
}

export const DEFAULT_AGENT_CRM: MockAgentCrm = {
  find: true,
  addLeads: false,
  ownerId: 'default',
  leadSource: 'WhatsApp',
  includeRequest: true,
};

const ACCOUNT = 'aisyah@kopiapong.my';
const ORG = 'Kopi Apong Sdn Bhd';
const ORG_DOMAIN = 'org80012345';
const USERS = [
  { id: 'u1', name: 'Aisyah Rahman' },
  { id: 'u2', name: 'Daniel Tan' },
  { id: 'u3', name: 'Mei Ling Ooi' },
];

const recordUrl = (region: ZohoRegion, module: string, id: string) =>
  `https://crm.zoho.${region}/crm/${ORG_DOMAIN}/tab/${module}/${id}`;
const digits = (jid: string) => jid.split('@')[0]!.replace(/\D/g, '');

/** Seeded CRM records, keyed by the WhatsApp number (digits). */
function demoRecords(): Map<string, Omit<MockCrmRecord, 'url'>> {
  return new Map([
    [
      '60123110021',
      {
        module: 'Contacts',
        id: '5725767000000412001',
        name: 'Farah Aziz',
        company: 'Farah Catering Co',
        owner: 'Daniel Tan',
        status: null,
        request: null,
        addedBy: null,
      },
    ],
    [
      '60128814455',
      {
        module: 'Contacts',
        id: '5725767000000412017',
        name: 'Priya Nair',
        company: null,
        owner: 'Aisyah Rahman',
        status: null,
        request: null,
        addedBy: null,
      },
    ],
    [
      '60129001234',
      {
        module: 'Leads',
        id: '5725767000000498003',
        name: 'Jason Lim',
        company: 'Lim Trading',
        owner: 'Mei Ling Ooi',
        status: 'Contacted',
        request: null,
        addedBy: null,
      },
    ],
  ]);
}

/** Set by registerZohoCrm so the seed can record the lead the AI added (seed.ts runs later). */
export let zohoSeed: {
  addLead(jid: string, name: string, company: string | null, request: string): void;
} | null = null;

export function registerZohoCrm(app: FastifyInstance, ctx: AppContext) {
  // The seeded demo starts connected; agent 1 finds customers and adds leads (the lead chat).
  const store = {
    state: 'connected' as MockZohoState,
    region: 'com' as ZohoRegion | null,
    account: ACCOUNT as string | null,
    agents: { a1: { ...DEFAULT_AGENT_CRM, addLeads: true } } as Record<string, MockAgentCrm>,
    records: demoRecords(),
    activity: demoActivity(),
  };
  const view = (): MockZohoCrmState => {
    const on = store.state !== 'disconnected';
    return {
      state: store.state,
      region: on ? store.region : null,
      account: on ? store.account : null,
      org: on ? ORG : null,
      users: on ? USERS : [],
      agents: store.agents,
      activity: store.activity,
    };
  };
  const record = (jid: string): MockCrmRecord | null => {
    const r = store.records.get(digits(jid));
    return r && store.region ? { ...r, url: recordUrl(store.region, r.module, r.id) } : null;
  };
  app.get('/api/mock/zoho-crm', { preHandler: requireUser(ctx) }, async () => view());
  app.post('/api/mock/zoho-crm/connect', { preHandler: requireAdmin(ctx) }, async (request) => {
    const { region } = parse(z.object({ region: z.enum(ZOHO_REGIONS) }), request.body ?? {});
    store.state = 'connected';
    store.region = region;
    store.account = ACCOUNT;
    return view();
  });
  app.post('/api/mock/zoho-crm/disconnect', { preHandler: requireAdmin(ctx) }, async () => {
    // Settings stay; the AI stops looking up and adding leads until it is connected again.
    store.state = 'disconnected';
    return view();
  });
  // Mock only: the sign-in-expired and Zoho-unavailable states.
  app.put('/api/mock/zoho-crm/state', { preHandler: requireAdmin(ctx) }, async (request) => {
    const body = parse(
      z.object({ state: z.enum(['connected', 'expired', 'unavailable']) }),
      request.body ?? {},
    );
    if (store.state !== 'disconnected') store.state = body.state;
    return view();
  });
  app.put<{ Params: { agentId: string } }>(
    '/api/mock/zoho-crm/agents/:agentId',
    { preHandler: requireAdmin(ctx) },
    async (request) => {
      const id = z.string().min(1).max(40).parse(request.params.agentId);
      const next = parse(AgentCrm, request.body ?? {});
      // Adding leads needs Find the customer (the server checks the number is new first).
      store.agents[id] = { ...next, addLeads: next.find && next.addLeads };
      return view();
    },
  );
  // Customer panel: the chat's CRM record (any signed-in user; production also checks inbox access).
  app.get<{ Params: { jid: string } }>(
    '/api/mock/zoho-crm/chats/:jid',
    { preHandler: requireUser(ctx) },
    async (request) => ({
      state: store.state,
      record: store.state === 'connected' ? record(request.params.jid) : null,
    }),
  );
  // "Add to Zoho CRM as a lead" by a teammate: name from the saved contact or the WhatsApp name.
  app.post<{ Params: { jid: string } }>(
    '/api/mock/zoho-crm/chats/:jid/lead',
    { preHandler: requireUser(ctx) },
    async (request, reply) => {
      const jid = request.params.jid;
      if (store.state !== 'connected')
        return reply.code(503).send({ error: 'Zoho CRM is not available right now.' });
      if (record(jid)) return reply.code(409).send({ error: 'Already in Zoho CRM.' });
      const chat = ctx.services.chats!.get(jid);
      const name = chat?.name?.trim() || digits(jid);
      store.records.set(digits(jid), {
        module: 'Leads',
        id: `57257670000005${String(store.records.size).padStart(5, '0')}`,
        name,
        company: null,
        owner: 'Aisyah Rahman',
        status: 'Not Contacted',
        request: null,
        addedBy: 'team',
      });
      store.activity.unshift({
        at: Date.now(),
        kind: 'added_by_team',
        agent: 'Aisyah',
        customer: name,
      });
      return { state: store.state, record: record(jid) };
    },
  );
  zohoSeed = {
    /** Seed: the AI added this chat's number as a lead. */
    addLead(jid: string, name: string, company: string | null, request: string) {
      store.records.set(digits(jid), {
        module: 'Leads',
        id: '5725767000000512044',
        name,
        company,
        owner: 'Aisyah Rahman',
        status: 'Not Contacted',
        request,
        addedBy: 'ai',
      });
    },
  };
}

/** Demo Activity: the seeded lead chat (Kavitha) and earlier look-ups (who and when, no chat text). */
function demoActivity(): MockCrmActivity[] {
  const now = Date.now();
  return [
    {
      at: now - 60_000,
      kind: 'added',
      agent: 'Aina',
      customer: 'Dr. Kavitha Menon',
      module: 'Leads',
    },
    { at: now - 90_000, kind: 'not_found', agent: 'Aina', customer: 'Dr. Kavitha Menon' },
    {
      at: now - 3 * 3_600_000,
      kind: 'found',
      agent: 'Aina',
      customer: 'Farah Aziz',
      module: 'Contacts',
    },
    {
      at: now - 5 * 3_600_000,
      kind: 'found',
      agent: 'Aina',
      customer: 'Jason Lim',
      module: 'Leads',
    },
    {
      at: now - 26 * 3_600_000,
      kind: 'not_added',
      agent: 'Aina',
      customer: 'Siti Rahman',
      reason: 'no_name',
    },
  ];
}
