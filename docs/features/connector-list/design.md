# Connector list: connectors managed outside the app

Status: **proposal** (mock in `mock/`, waiting for the owner's confirmation). Branch `feat/connector-list`, stacked on
`claude/sleepy-fermat-ahpoii` (ossmalaysia/ezychat-lite#192, Google Calendar connector).

## Owner decisions (2026-10-27)

- "we just need a way for ezychat lite or enterprise to load connector gallery and detail, user can connect to it,
  connection still use ezychat and the sponsor or partner MCP, is not ezychat server".
- The list lives in a **public repo in anchorsprint**: `anchorsprint/ezychat-connectors`.
- **Connector schema version**: "if old app will not compatible with new connector schema version it will not show".
- The list carries **no secret keys** (it is public; the signature proves origin, not secrecy).
- Google's own MCP server for Google Calendar is confirmed: "what we discuss is how to make connector listing and
  connector more external manage". So every connector, Google Calendar included, can come from the list; the
  safety checks that PR #192 has in code become **declared guards** that the core enforces for any connector.
- Lite and Enterprise both load the list. The **Custom connector (MCP)** (any address an admin types) stays
  Enterprise only.

## Why

Today the gallery and each connector are app code: a new connector, a better description or a changed AI
instruction needs a release of both editions. Partners cannot add their own. The owner wants Anthropic's model: the
list is published on demand, the user connects from their own EzyChat straight to the partner's MCP server, and the
app needs no update.

## Baseline

- Cloned from the owner-confirmed **google-calendar** mock (`latestConfirmed`, revision `f46aab96`), the whole app.
- Added before the change (they are confirmed or built, not part of this proposal):
  - the **Reports** screens from `docs/features/reports/mock` (confirmed `ce56468`; the index note asks the next
    clone to add them);
  - the **Bookings** tab and **Open Google Calendar** links, built in PR #192 without a mock (owner waived it,
    2026-10-27); the real screens are the reference (`docs/screenshots/connectors/google-calendar-bookings-*`);
  - booking details (name, email, phone) in the Google Calendar texts.
- Retention: this is feature 17; `business-api` (12) is pruned (history keeps it).

## Concepts

| Kind                   | What runs where                                                                              | Example                                                               | In the list as                  |
| ---------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------- |
| **MCP connector**      | The partner's (or Google's) MCP server; EzyChat is the MCP client on the customer's computer | Google Calendar via Google's MCP server, an accounting or CRM partner | `kind: "mcp"`                   |
| **Built-in connector** | Code inside the app                                                                          | Google Calendar today (PR #192), until the MCP entry matches it       | `kind: "builtin"` (`builtinId`) |
| **Coming soon**        | Nothing yet; **Vote for this connector** (WhatsApp link, nothing counted in the app)         | AutoCount, Xero                                                       | `kind: "coming_soon"`           |
| **Custom connector**   | Any MCP address the admin types (Enterprise only)                                            | an in-house system                                                    | not in the list (app feature)   |

## The repository `anchorsprint/ezychat-connectors` (public)

```text
schema/connector-v1.json      JSON Schema of one entry (schemaVersion 1)
connectors/<id>.json          one file per connector (partners send a pull request)
icons/<id>.svg                square icon, 64 px or larger
scripts/build.mjs             validates every entry, builds the list, signs it
.github/workflows/publish.yml on merge to main: validate → build → sign → upload to R2 (dl.ezychat.ai)
```

- Published files: `https://dl.ezychat.ai/connectors/list-v1.json` and `list-v1.json.sig`, plus `icons/`.
- The signing key (Ed25519) is only in the repo's protected `release` environment secret; it never appears in the repo.
- A partner adds or changes its file through a pull request; Anchor Sprint reviews and merges (only the owner merges).

## List file (format 1)

```jsonc
{
  "format": 1, // the list file format; an app that cannot read it keeps its last good copy
  "generatedAt": "2026-10-27T10:00:00Z",
  "sequence": 42, // increases on every publish; an app never accepts a lower one (no roll-back)
  "entries": [/* connector entries, each with its own schemaVersion */],
}
```

- `list-v1.json.sig` = Ed25519 signature of the exact bytes. The app holds **two public keys** (current and next,
  for rotation) and accepts the list only when one of them verifies it.
- The app reads the list at start and every 24 hours (and on **Check for new connectors**), keeps the last good copy
  in the data folder, and falls back to the copy shipped in the app (the built-in catalog) when it has none.
- Lists are public: no secret, no token, no customer data.

## Connector entry (schemaVersion 1)

| Field                                                                         | Meaning                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `schemaVersion`, `minAppVersion`                                        | An app shows an entry only if it supports `schemaVersion` and its version ≥ `minAppVersion`. Within one schema version, fields are only added and optional; an app ignores fields it does not know. A breaking change gets a new schema version.                                                                        |
| `kind`                                                                        | `mcp`, `builtin`, `coming_soon`                                                                                                                                                                                                                                                                                         |
| `editions`                                                                    | `["lite", "enterprise"]` or `["enterprise"]` (Lite shows the latter with **Enterprise**)                                                                                                                                                                                                                                |
| `name`, `summary`, `description`, `category`, `icon`, `publisher`, `homepage` | Gallery and detail texts; `summary`/`description` per language (`en`, `ms`, `zh-CN`; English when one is missing)                                                                                                                                                                                                       |
| `privacy`                                                                     | The sentence shown before Connect: who receives which data ("Your calendar data goes between your computer and Google.")                                                                                                                                                                                                |
| `mcp.url`                                                                     | `https` only. The app connects to it directly from the customer's computer                                                                                                                                                                                                                                              |
| `auth`                                                                        | `{ "type": "oauth", "clientId"?: "…", "scopes": [...] }` (MCP authorization: discovery, dynamic client registration when there is no `clientId`, PKCE S256, loopback redirect), or `{ "type": "api_key", "label": "…", "help": "…" }` (the admin pastes their own key), or `{ "type": "none" }`. Never a client secret. |
| `tools`                                                                       | The tools EzyChat may use (any other tool of the server is ignored): `name`, `title`, `access` (`read` or `write`), `instructions` (skill text for that tool), `guards` (below)                                                                                                                                         |
| `skill`                                                                       | Instructions for the AI for the whole connector, per language. Data for the model, never above the core safety rules                                                                                                                                                                                                    |
| `settings`                                                                    | A small form per AI agent (`text`, `number`, `select`, `toggle`, `days`, `timeRange`, `calendarPicker` from a read tool); values go to the AI and the guards                                                                                                                                                            |
| `vote` (coming soon)                                                          | The Vote message                                                                                                                                                                                                                                                                                                        |

Example (Google Calendar through Google's MCP server; tool names are placeholders until we read Google's server):

```jsonc
{
  "id": "google-calendar",
  "schemaVersion": 1,
  "minAppVersion": "0.1.62",
  "kind": "mcp",
  "editions": ["lite", "enterprise"],
  "category": "calendar",
  "publisher": "Google",
  "privacy": {
    "en": "Your calendar data goes between your computer and Google. No chat text goes to Google.",
  },
  "mcp": { "url": "https://<google calendar mcp>" },
  "auth": {
    "type": "oauth",
    "clientId": "<ezychat-prod desktop client id>",
    "scopes": ["calendar.calendarlist.readonly", "calendar.freebusy", "calendar.events.owned"],
  },
  "settings": [
    { "id": "calendar", "type": "calendarPicker", "from": "list_calendars" },
    { "id": "hours", "type": "timeRange", "default": ["10:00", "18:00"] },
    { "id": "days", "type": "days", "default": [1, 2, 3, 4, 5, 6] },
    { "id": "length", "type": "select", "options": [30, 60, 90], "default": 60 },
  ],
  "tools": [
    { "name": "freebusy", "title": "Check free times", "access": "read" },
    {
      "name": "create_event",
      "title": "Book appointments",
      "access": "write",
      "guards": {
        "confirmFirst": true,
        "valueFrom": { "start": "freebusy" },
        "fromCustomer": ["attendee.name", "attendee.email", "attendee.phone"],
        "within": { "start": "settings.hours", "day": "settings.days" },
        "limits": { "perChat": 3, "perDay": 50 },
      },
    },
  ],
  "skill": {
    "en": "Offer only free times from Check free times. Ask for the name, email and phone that are missing before booking. Never cancel or move an event: hand over.",
  },
}
```

## Guards (core code, declared per tool)

The checks PR #192 has in Google Calendar code become general rules any entry can turn on. The core runs them
before it calls the partner's tool, so a list entry can only add checks, never remove the core rules.

| Guard                    | Rule                                                                                                                                                                                            | From PR #192                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| always for `write` tools | off until an admin turns the tool on for an AI agent; Try it never runs it (shows "would …"); one general core rule (use only as described, report done only when the tool says so, never undo) | Book appointments off by default; `notRun` |
| `confirmFirst`           | runs only when the customer wrote after the AI's proposal                                                                                                                                       | `no_reply_since`                           |
| `valueFrom`              | an argument must be a value a read tool returned in this chat (last 24 h)                                                                                                                       | `not_offered` (offered times)              |
| `fromCustomer`           | an argument must come from the saved contact or the customer's own messages                                                                                                                     | name, email, phone                         |
| `within`                 | an argument must fit the agent's settings                                                                                                                                                       | booking hours and days                     |
| `limits`                 | calls per chat and per day                                                                                                                                                                      | —                                          |
| `noUndo` (default)       | tools that delete or change earlier results are not listed; such requests hand over                                                                                                             | never cancel or move                       |

Every call logs connector, tool, ok and ms (never arguments or results) and adds an Activity line; a refused call
returns a fixed text that tells the AI what to ask, as `book_appointment` does today.

## Screens (mock checklist)

1. **Gallery** (Admin → Connectors): entries from the list; **Your connectors** first; categories and search; a
   line under the title "Connector list updated 2 hours ago · Check for new connectors". States: list loaded;
   **offline** (last copy, note); **list rejected** (bad signature: uses the last good copy, warning for admins);
   entry that needs a newer EzyChat ("Update EzyChat to use this connector", greyed); Lite with Enterprise-only.
2. **Partner (MCP) detail**: publisher and homepage, what it does, what the AI can do (tools with Look-up /
   Changes data), the **privacy line** ("Your data goes between your computer and <publisher>"), **Connect**.
3. **Connect**: OAuth → the partner's sign-in in a new tab, waiting card, connected; **API key** dialog (label,
   help link, paste, Test, Save); failure states (cancelled, could not reach the server, key refused).
4. **Settings per AI agent**: the entry's form (calendar picker, hours, days, length) and one switch per tool
   (Changes data tools off by default), with a **Rules the AI always follows** box listing the guards in plain words.
5. **Activity**: tool calls (checked, booked, refused with the reason, failed), never chat text.
6. **Connected but no longer listed**: keeps working; note "No longer in the connector list; disconnect when you
   no longer need it".
7. **Google Calendar** shown as an MCP connector (publisher Google) next to the built-in one only in a mock-only
   switch, to compare; the built-in pages (Overview, Settings, Activity, Bookings) stay as in the app.
8. Desktop 1280 px and mobile 360 px, light and dark, Lite and Enterprise.

## Not in this round

- Signed connector **packages** that run code on the customer's computer (later; see the Google Calendar option 4
  discussion).
- Paid or sponsored listing, partner self-service portal, ratings.
- Moving Google Calendar from built-in to its MCP entry (next step after this design, once Google's tool names
  and behaviour are checked against the guards).

## Open questions for the owner

1. Who may send entries: only partners we invite (we review every pull request), or anyone (we still review)?
2. A connector removed from the list while connected: keep working with the note (proposal), or stop?
3. List refresh: at start and every 24 hours (proposal), or only at start?
4. Icons: hosted with the list on dl.ezychat.ai (proposal), or the partner's own address (privacy: the app would
   call the partner before the user connects)?

## Mock coverage

Run: `npx tsx --conditions=ezychat-source docs/features/connector-list/mock/run.ts --fake-wa`, open
`http://localhost:7487/` (API 7486), sign in as `aisyah` / `demo-pass-123`. Details: [mock/README.md](mock/README.md).
Screenshots: `node docs/features/connector-list/mock/connector-list-shots.mjs` (1280 px and 360 px touch, light and
dark, into `mock/screenshots/`).

- **Source**: cloned from the confirmed google-calendar mock at `f46aab96` with `git archive` (the branch folder of
  google-calendar and reports carries conflict markers from merge `049226a`; the confirmed revisions are clean).
  Reports copied unchanged from `docs/features/reports/mock` on `origin/main` (`8b09a9e`).
- **Baseline additions**: Admin → Reports (first admin item, `/admin/reports`); Google Calendar Bookings tab
  (`/admin/connectors/google-calendar?tab=bookings`: 4 upcoming, 2 past, Open chat, Open in Google Calendar), Open
  Google Calendar beside Disconnect, the Your data text naming name, phone and email (ms and zh-CN from the app).
- **Demo list** (format 1, sequence 42, published 2 hours before start): Google Calendar (builtin, connected); Google
  Calendar (MCP) by Google (shown only by the Mock only switch); Lejar Accounting (fictional partner, OAuth,
  connected, en/ms/zh-CN texts); Kedai CRM (fictional, API key); Gudang Stock (Enterprise only); Bayar Payments
  (`minAppVersion` 0.2.0, the app is 0.1.62: greyed, "Update EzyChat to use this connector"); one schema-2 entry
  (never shown; the Mock only box counts it); the 14 existing coming-soon entries with Vote, their texts and tools
  copied from today's catalogs. The custom connector (MCP) stays an app feature, Enterprise only.
- **Screens and states** (checklist numbers above):
  1. Gallery `/admin/connectors`: status line and Check for new connectors (toast); Mock only box at the bottom:
     list Loaded / Offline (info banner, copy from 2 hours ago) / Bad signature (warning banner, last good copy);
     Google Calendar (MCP) Hidden / Shown; Lejar Accounting Listed / Removed. Lite: `?edition=lite`.
  2. Partner page `/admin/connectors/lejar-accounting`: publisher, website link, what it does, tools with Look-up /
     Changes data, Connection card, Your data with Show details for your developer (server address, sign-in type,
     entry id and schema).
  3. Connect: OAuth `/admin/connectors/google-calendar-mcp` (switch Shown first) → stand-in partner page in a new
     tab (`/api/mock/connector-list/partner/sign-in`, Allow / Cancel), waiting card (polls), cancelled, connected;
     API key `/admin/connectors/kedai-crm` → dialog (label, Where do I find my key?, Test key, Save; `kd_demo12345`
     works, any other key is refused); partner server Unreachable (Mock only box on the Connection card) for both.
  4. Settings `?tab=settings`: the entry's form (Lejar: select, toggle, text; Kedai: days, time range, select,
     toggle; Google MCP: calendar picker, time range, days, select), one switch per tool (Changes data off by
     default), Rules the AI always follows (core rules plus each tool's declared guards in plain words), Save.
  5. Activity `?tab=activity` (Lejar): Looked up, Done, Refused with the reason, Failed; never chat text.
  6. Removed from the list while connected: card "No longer listed" under Your connectors, note on the page.
  7. Google Calendar (MCP) next to the built-in Google Calendar (whose pages stay as in the app).
  8. Lite: Gudang Stock and the custom connector with Enterprise and Upgrade; agent page Connectors card lists the
     connected partner connectors ("3 of 3 tools on").
- **Gaps**: the partner sign-in is a local stand-in page and API keys follow a fixed rule (no MCP discovery or real
  OAuth); Try it and the chat do not show partner tool calls (the AI's refusals show only in Activity); the
  Google Calendar (MCP) settings are separate from the built-in connector's (no migration shown); icons are stand-in
  Lucide icons, not the list's `icons/<id>.svg`; mock-only and partner texts are English in all catalogs.
