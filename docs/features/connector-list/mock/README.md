# Connector list interactive app proposal

A clone of the owner-confirmed **google-calendar** reference (the whole app, `latestConfirmed` revision
`f46aab96`), with two **baseline additions** that are confirmed or already built, and the **connector list**
proposal on top. Scope, decisions and the screen checklist: [../design.md](../design.md). Mock-only texts are
English in all three catalogs.

- Baseline additions (not part of the proposal): **Admin → Reports** from `docs/features/reports/mock` (confirmed
  2026-10-26, copied from `origin/main`), and the Google Calendar **Bookings** tab, the **Open Google Calendar**
  links and the "Your data" text naming name, phone and email, as built in PR #192 (`apps/web/src/admin/connectors`).
- Proposal: the gallery reads the **connector list** (format 1, entries with `schemaVersion`, `minAppVersion`,
  `kind`, `editions`); partner (MCP) connectors get their own page with Connect (partner sign-in in a new tab, or an
  API key), Settings per AI agent built from the entry, the rules the AI always follows, and Activity.

From the repository root, after the normal `npm install` (Node 22 or later):

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/connector-list/mock/run.ts --fake-wa
```

Open `http://localhost:7487/` (API on `127.0.0.1:7486`). Nothing calls Google, a partner, WhatsApp, OpenAI or
Anthropic: the runner blocks every outside request. The list and the partners are stand-ins
(`connector-list.ts`, routes `/api/mock/connector-list*`); Google is a stand-in (`google-calendar.ts`).

## Walkthrough

1. Sign in as `aisyah`. **Admin → Connectors**: the gallery from the list, with "Connector list updated 2 hours
   ago · Check for new connectors" under the title. Lejar Accounting and Google Calendar are under Your
   connectors; Kedai CRM (API key) is not connected; Bayar Payments needs a newer EzyChat (greyed); one entry with
   connector schema 2 is never shown. The dashed **Mock only** box at the bottom switches the list (Loaded /
   Offline / Bad signature), shows the **Google Calendar (MCP)** entry next to the built-in one, and removes Lejar
   Accounting from the list. Add `?edition=lite` for the Lite view (Gudang Stock and the custom connector show
   Enterprise).
2. **Lejar Accounting** (OAuth, connected): Overview (publisher and website, what it does, what the AI can do with
   Look-up / Changes data badges, Connection, Your data with "Show details for your developer"), **Settings** (the
   entry's form: select, toggle, text; one switch per tool; Rules the AI always follows), **Activity** (looked up,
   done, refused with the reason, failed). With Lejar removed from the list: the "No longer in the connector list"
   note.
3. **Kedai CRM** (API key): the privacy line before Connect, **Connect with an API key** (label, Where do I find my
   key?, paste, Test key, Save). A key like `kd_demo12345` works; any other key is refused. Set the Mock only
   **Kedai Digital Sdn Bhd server** to Unreachable for the could-not-reach state. After saving: Settings (days,
   time range, select, toggle).
4. **Google Calendar (MCP)** (show it first in the gallery's Mock only box): **Connect** opens the stand-in partner
   sign-in page in a new tab (Allow / Cancel) while the page shows the waiting card; Cancel shows "Sign-in
   cancelled"; Allow connects; Settings has the calendar picker. Unreachable server: Connect shows "Could not
   reach".
5. **Bayar Payments**: "Update EzyChat to use this connector". **Bukku** (and the other coming-soon entries):
   Vote for this connector.
6. Baseline additions: **Google Calendar → Bookings** (4 upcoming, 2 past, Open chat, Open in Google Calendar),
   Overview → **Open Google Calendar**; **Admin → Reports** (first admin item); the agent page Connectors card
   lists Lejar Accounting too.

## Checks

```powershell
npx tsc -p docs/features/connector-list/mock/tsconfig.json
node docs/features/connector-list/mock/snapshot.mjs --check
# With the seeded mock running (fresh browser contexts; light and dark, 1280 px and 360 px touch; installed
# Chrome unless PW_CHROMIUM is set). It changes the mock's data: restart the mock afterwards.
node docs/features/connector-list/mock/connector-list-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
`calendar-shots.mjs`, `reports-shots.mjs`, `phrase-shots.mjs`, `suggest-shots.mjs`, `business-api-shots.mjs`,
`upgrade-shots.mjs`, `send-reaction-shots.mjs`, `reaction-shots.mjs`, `agent-shots.mjs` and `inbox-shots.mjs` are
inherited scripts (pointed at this mock's port).
