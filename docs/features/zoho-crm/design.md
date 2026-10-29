# Zoho CRM connector (built in): the AI finds the customer and adds new leads

Status: **proposal**, waiting for the owner's confirmation. Branch `claude/adoring-knuth-al5vph` from `main`
(`5709439`, 0.1.62).
Mock: [mock/index.html](mock/index.html) ([run it](mock/README.md)). Screenshots: `mock/screenshots/zoho-*`
(`zoho-shots.mjs`, 76 shots, no page errors, no horizontal overflow).

## Owner request (2026-10-28)

- "i want to create zoho CRM connector".
- Route chosen by the owner: **built in, Zoho OAuth** (like Google Calendar), not Zoho's own MCP server. Reason:
  Zoho MCP gives each customer a private server URL that works like a password, and the connector list (schema 1)
  allows only non-secret values in `mcp.url`; its tool names also depend on how each customer sets up their Zoho
  MCP server, so our guards could not be declared once.
- Editions: core, **Lite and Enterprise** (owner rule 2026-10-26: every ready connector is offered to all; only the
  custom MCP connector is Enterprise only). Confirmed in chat 2026-10-28 ("so this will be offer to all lite and
  enterprise?" → yes, per that rule).

## Baseline

- Cloned from the owner-confirmed **ai-groups** mock (`latestConfirmed`; that index entry records the PR-branch
  revision `ea63248`; this clone is the squash-merged copy on `main`, `80de805`, unchanged since), the whole app.
- Reused, not redesigned: the connector gallery and connector page (`ConnectorDetailPage`: Overview / Settings /
  Activity, `AgentSettings` agent picker), the Google Calendar account card pattern (`GoogleCalendarSection`:
  sign-in dialog, states, Disconnect confirm, mock state switch), the per-agent settings card pattern
  (`AgentBookingsCard`: switches with a Changes badge, rules box, `SaveBar`), the agent page Connectors card,
  the `ai_tool_used` chat lines (`EventItem`), the customer panel (`CustomerPanel`).
- Retention: this is the sixth feature folder; the oldest, `ai-phrase-dictionary` (creation order 14, last
  revision `5709439`), is pruned in the same change (git history keeps it).

## Behaviour (proposal)

| Item               | Proposal                                                                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in            | Admin → Connectors → Zoho CRM → choose the Zoho site (zoho.com, .eu, .in, .com.au, .jp, zohocloud.ca, .sa) → **Connect Zoho CRM** opens Zoho's own sign-in in the browser. One Zoho account per install. Tokens only in an encrypted setting. Disconnect any time; Zoho records stay.    |
| Find the customer  | Look-up, **on** by default per agent. Before answering a direct chat, the server searches Contacts, then Leads, by the chat's WhatsApp number (the tool takes no arguments). The AI gets name, company (Account / Company), owner, lead status. Cached per chat for 10 minutes.          |
| Add new leads      | Changes data, **off** by default per agent; needs Find the customer. The AI may add one Lead when the number is in neither module and the customer makes a real enquiry: name, WhatsApp number, email and company when given, Lead Source (default "WhatsApp"), owner, and (switch, on) a one-line summary of the request in Description. |
| Server guards      | Number re-checked in Contacts and Leads just before the insert (no duplicates); one lead per chat (idempotent); a name is required: the saved contact or WhatsApp name, else a value found in the customer's own messages (as Google Calendar's `contact.ts`); only after a newer customer message; never updates or deletes records (hands over); not in groups; Try it never adds. |
| Lead owner         | "Zoho default" (the signed-in user; Zoho's assignment rules and workflows run as Zoho decides) or one Zoho user.                                                                                                                                                                          |
| Team visibility    | Chat lines: "AI found the customer · Zoho CRM", "AI looked up the customer: not found · Zoho CRM", "AI added a lead · Zoho CRM". Customer panel: a Zoho CRM card for every teammate with access to the chat (Contact/Lead, owner, status, request, Open in Zoho CRM), or "Not in Zoho CRM yet" + **Add as a lead** (teammate action, audited). |
| Activity tab       | Found / not found / added / added from the chat / not added (already in Zoho CRM, no name yet, Zoho unavailable). Who and when only, never chat text.                                                                                                                                    |
| Failure            | Sign-in expired or Zoho unreachable: Needs attention in the gallery and on the page; the AI answers **without** Zoho CRM (a look-up failure does not hand the chat over) and adds no leads; customers are not told. The customer panel says Zoho CRM is not available.                    |
| Data to Zoho       | Look-up: the WhatsApp number only. New lead: name, number, email and company when given, the one-line summary. Never the chat. The desktop or service connects straight to Zoho (no EzyChat server). Logs: ids, counts, outcome, ms; never names, numbers or text.                         |
| Connector list     | `anchorsprint/ezychat-connectors` `connectors/zoho-crm/`: `kind: coming_soon` → `kind: builtin`, `builtinId: zoho-crm`, `minAppVersion` = the release that ships it (older apps show "Needs a newer EzyChat"). Merged only after that Lite release.                                         |

## Screens (mock checklist)

1. Gallery: Zoho CRM connected (Your connectors), needs attention. ✓ `01`, `09`
2. Zoho CRM page Overview: connected (organisation, account, site, Open Zoho CRM, Disconnect), expired (Sign in
   again), unavailable, not connected with the Zoho site choice, stand-in Zoho sign-in with scopes. ✓ `02`, `06`,
   `08`, `10`, `11`, `12`
3. Settings per agent: Add new leads on (owner, Lead Source, summary switch), find only, paused banner, not
   connected. ✓ `03`, `04`, `07`, `13`
4. Activity. ✓ `05`
5. Agent page Connectors row. ✓ `14`
6. Chat with the two Zoho CRM lines. ✓ `15`
7. Customer panel: Lead added by the AI, Contact, not in Zoho CRM with Add as a lead. ✓ `16`, `17`, `18`
8. Lite view (same connector). ✓ `19`
9. Desktop 1280 px and mobile 360 px touch, light and dark. ✓ (every shot in 4 variants)

## Not in this round

- Deals, quotes, tasks, notes, calls; updating an existing record (the AI hands over).
- Writing the conversation or a transcript into Zoho (privacy; the summary switch is the only text).
- Zoho Bigin, Zoho Desk, Zoho Books (separate connectors).
- Two-way sync of the EzyChat customer profile with Zoho fields.
- Group chats.

## Server plan (for the build, our call)

- `connectors/zoho-crm/` like `connectors/google-calendar/`: OAuth sign-in, token refresh, an encrypted
  `zoho_crm_tokens` setting with the account's `api_domain`, guarded fetch (https, Zoho hosts only, timeouts),
  Zoho CRM REST API v8 (`/crm/v8/Contacts/search?phone=`, `/Leads/search?phone=`, `POST /Leads`, `/users`, `/org`).
- Migration: `zoho_crm_agent_settings` (agent_id, find, add_leads, owner_id, lead_source, include_request) and
  `zoho_crm_leads` (chat key, record id, at) for the one-lead-per-chat guard.
- AI tools `find_crm_customer` / `add_crm_lead` in `ai/agent/tools.ts`, offered through `turn-tools.ts` only when
  connected and switched on; core tool names reserved; the tool descriptions and result notes carry the
  instructions (no Zoho name in `CORE_RULES`).
- Routes `/api/connectors/zoho-crm/*` (admins), `GET /api/chats/:jid/zoho-crm` and `POST …/zoho-crm/lead` (inbox
  access, rate-limited, audit `zoho_crm.lead_add`).
- Fake Zoho for tests and `--fake-wa` (as `fake.ts` for Google); tests never call Zoho.
- Zoho API client: a client registered by Anchor Sprint in the Zoho API Console, carried like the Google one
  (`ZOHO_OAUTH_CLIENT_ID`/`_SECRET` from the environment, else the release bundle's `define` from repository
  secrets); without it the state is `not_configured`.

## To verify with Zoho before building (not confirmed yet)

1. **Redirect URI**: whether Zoho accepts a loopback redirect on any port (our server port is configurable, and
   Enterprise uses its own default port) or needs exact URIs. If exact only, use the device-style flow for
   "non-browser" clients instead. This decides the sign-in code.
2. **Data centres**: the exact list and whether one client works in all of them (multi-DC setting), and how the
   token response names the account's API host.
3. **Scopes**: the minimum set (proposed `ZohoCRM.modules.contacts.READ`, `ZohoCRM.modules.leads.READ`,
   `ZohoCRM.modules.leads.CREATE`, `ZohoCRM.users.READ`, `ZohoCRM.org.READ`).
4. **API limits**: credits per organisation per day by Zoho edition; the 10-minute cache and the one-lead rule
   keep usage low, but a free-edition org may still run out.
5. Whether Zoho needs any review before a public desktop app may use the client.
6. Review: nothing found in Zoho's docs (2026-10-29), not confirmed. Check by signing in from a Zoho account of
   another organisation (and on zoho.eu) once the client exists; optionally ask Zoho support.
7. Test organisation: never Anchor Sprint's own Zoho CRM (real customer data). A separate Zoho account and a new
   CRM organisation with demo data only (proposal 2026-10-29); whether a free or developer edition is enough is
   not confirmed.

## Open questions for the owner

Answered 2026-10-29: (1) Add new leads **off by default**: yes. (2) Request summary **on by default**: yes.
(3) Keep **Add as a lead** for teammates: yes. (4) Zoho API client: the owner asked whether it needs a Zoho
account; answer: yes, a company-owned Zoho account registers the app (not a customer's, not a personal one);
which account is still open.
## Confirmation

Not confirmed yet. No production code is written before the owner confirms this mock.
