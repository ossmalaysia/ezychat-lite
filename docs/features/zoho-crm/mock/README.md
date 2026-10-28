# Zoho CRM connector (built in): interactive app proposal

A clone of the owner-confirmed **ai-groups** reference (the whole app, `latestConfirmed`; cloned from `main`
`5709439`, where the folder is the squash-merge `80de805` of that PR) with the **zoho-crm** proposal on top:
Zoho CRM becomes a built-in connector, like Google Calendar. The admin signs in with Zoho (no link or key); the AI
finds the customer by WhatsApp number before it answers and, when allowed, adds new enquiries as leads; the team
sees the Zoho record beside each chat. Scope, rules and the screen checklist: [../design.md](../design.md).

Every inherited flow still works (groups, connectors, Reports, Google Calendar, reply suggestions, phrase list,
reactions, inboxes, AI agents); their walkthroughs are in the ai-groups README (`docs/features/ai-groups/mock/README.md`,
or git history once that folder is pruned). Mock-only control texts are English in all three catalogs; the new
user-facing texts have Malay and Chinese.

From the repository root, after the normal `npm install` (Node 22 or later):

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/zoho-crm/mock/run.ts --fake-wa
```

Open `http://localhost:7489/` (API on `127.0.0.1:7488`). The seed takes about a minute. Nothing calls WhatsApp,
an AI provider, Google, Zoho or a partner: the runner blocks every outside request. Zoho is a stand-in
(`zoho-crm.ts`, routes `/api/mock/zoho-crm*`) with canned records keyed by the WhatsApp number.

## Seed data

| Chat              | In Zoho CRM                                                     | What it shows                                                                                         |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Kavitha**       | Lead added by the AI (Dr. Kavitha Menon, Bright Dental Clinic)  | Catering enquiry; "AI looked up the customer: not found · Zoho CRM", name asked, "AI added a lead".   |
| Farah Aziz        | Contact (Farah Catering Co, owner Daniel Tan)                   | Customer panel: Contact card, Open in Zoho CRM.                                                       |
| Jason Lim         | Lead (Lim Trading, Contacted, owner Mei Ling Ooi)               | Customer panel: Lead with status.                                                                     |
| Priya Nair        | Contact                                                         |                                                                                                       |
| Every other chat  | Not in Zoho CRM                                                 | Customer panel: "Not in Zoho CRM yet." + **Add as a lead** (a teammate adds it).                      |

Zoho CRM starts **connected** (zoho.com, organisation Kopi Apong Sdn Bhd); Aina has Find the customer **on** and
Add new leads **on** (so the lead chat makes sense; a new install has Add new leads off).

## Walkthrough

1. **Admin → Connectors**: Zoho CRM under Your connectors (Connected), "Built into EzyChat".
2. **Zoho CRM** (`/admin/connectors/zoho-crm`): Overview (what it does, the two AI tools with Look-up / Changes
   data, the Zoho account card: organisation, account, Zoho site, Open Zoho CRM, Disconnect, Your data). The
   dashed **Mock only** panel switches Zoho between Working, Sign-in expired and Zoho unavailable.
3. **Disconnect** (confirm): the card asks _Where is your Zoho account?_ (zoho.com, .eu, .in, .com.au, .jp,
   zohocloud.ca, .sa), then **Connect Zoho CRM** opens the stand-in Zoho sign-in (scopes listed), Accept.
4. **Settings** tab: per AI agent (Enterprise: pick the agent): Find the customer, Add new leads ("Changes Zoho
   CRM", needs Find), and with leads on: Lead owner (Zoho default or a Zoho user), Lead Source, the one-line
   request summary switch, Rules the AI always follows, Save bar.
5. **Activity** tab: found / not found / added / added from the chat / not added with the reason.
6. **Admin → Members → Aina**: Connectors card row "Zoho CRM · Finds customers and adds new leads".
7. **Inbox → Kavitha**: the two Zoho CRM lines; open the customer panel (click the name): Zoho CRM card (Lead,
   request summary, Added by the AI, Open in Zoho CRM). **Ahmad Zulkifli**: Not in Zoho CRM yet → Add as a lead.
8. `?edition=lite`: the same connector (core in both editions).

Screenshots: `node docs/features/zoho-crm/mock/zoho-shots.mjs` against the running mock (set `PW_CHROMIUM` to a
Chromium binary when Playwright's own is missing) writes `screenshots/zoho-*` at desktop 1280 / mobile 360,
light and dark, and reports page errors and horizontal overflow.

Drift check: `node docs/features/zoho-crm/mock/snapshot.mjs --check`.
