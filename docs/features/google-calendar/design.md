# Connector gallery and Google Calendar connector (AI checks free times and books)

Status: **confirmed** 2026-10-26 (mock revision `f46aab9`).
Mock: [mock/index.html](mock/index.html) ([run it](mock/README.md)). Screenshots: `mock/screenshots/` (`calendar-shots.mjs`).

## Baseline

- Cloned from the owner-confirmed **ai-phrase-dictionary** mock (`latestConfirmed`, revision `db1df77`). Every
  existing flow is kept; the drift check (`snapshot.mjs --check`) freezes the inherited files.
- App at proposal: 0.1.59 (`027a03e`).
- Reused app parts: Settings → Integrations (`SettingsPage`, `IntegrationsSection` below the new card), the agent
  page (`AgentPage`: a card after Business context, before Try it), `AgentTryIt`, the chat event line
  (`EventItem`, event type `ai_tool_used` — the "AI looked up …" line Enterprise connectors already store),
  `Card`, `Switch`, `Select`, `Checkbox`, `Input type=time`, `Badge`, `Banner`, `ResponsiveDialog`,
  `ConfirmDialog`, `SaveBar`, `SegmentedControl`.

## Why

A request for Google Calendar. Owner (2026-10-26): Lite gets **ready connectors** with no link to paste
("ezychat lite also can connect to calender without fill in the link"); Enterprise keeps the custom MCP
connector with read and write tools ([anchorsprint/ezychat-enterprise#41](https://github.com/anchorsprint/ezychat-enterprise/pull/41)).

## Round 2 (owner, 2026-10-26)

"We need better connector Gallery, and each connector has its own details and configuration." The Google
Calendar card in Settings → Integrations and the Bookings card on the agent page are replaced by:

- **Admin → Connectors** (new nav item): a gallery of ready connectors with search and category chips
  (Calendar & booking, Spreadsheets, Payments, Online shop, Custom). Connected ones first ("Your connectors").
  Each card: icon, name, one line, category, status (Connected, Needs attention, Not connected, Coming soon,
  Enterprise). Listed: Google Calendar (core, ready), Google Sheets (core, coming soon), HitPay and Shopify
  (core, coming soon), Custom connector (MCP) (Enterprise, ready there).
- **One page per connector** (`/admin/connectors/:id`): header with status; tabs **Overview** (what it does,
  what the AI can do with Look-up / Changes data badges, the Google account card, Your data), **Settings**
  (per AI agent: calendar, Check free times, Book appointments, booking rules; an agent picker when there are
  several) and **Activity** (what the AI checked, booked or handed over; never chat text). Coming-soon and
  Enterprise-only connectors show the overview with a Coming soon note or the Upgrade to Enterprise button.
- **Enterprise-only connectors in Lite** (owner, 2026-10-26: "ok to add in custom connector but grey out and
  mark enterprise only"): the Custom connector (MCP) stays listed in Lite, greyed out (dashed card,
  faded icon) with the badge **Enterprise only**; its page explains it and shows Upgrade to Enterprise.
- **More business connectors, coming soon** (owner, 2026-10-26): AutoCount, SQL Account, Bukku, Xero, Zoho Books
  (Accounting), Zoho CRM, HubSpot (CRM), WooCommerce, EasyStore, StoreHub (Online shop), Billplz (Payments). Coming soon.
- **Every ready connector is offered in Lite and Enterprise** (owner, 2026-10-26: "All connector can be offer for
  all"): Google Calendar, Google Sheets, the accounting, CRM, online-shop and payment connectors are core. Only the
  Custom connector (MCP) is Enterprise only (greyed out in Lite). The vote number `601159246128` is confirmed.
- **Vote for this connector** on every coming-soon card and page: opens WhatsApp to the EzyChat team
  (`wa.me/601159246128`, the website's contact number) with a ready message naming the connector, in the UI
  language. Nothing is counted inside the app (no tracking in Lite); the team counts the requests. The gallery footer
  has **Ask for a connector** (same WhatsApp, open message). In the app the number is a `useAppLinks()` link an
  edition may change or hide.
- **Agent page → Connectors**: a short summary row per connected connector ("Checks free times; your team
  books") that opens the connector's Settings tab, and Browse connectors.
- **Settings → Integrations**: a pointer to Admin → Connectors.
- Editions: the gallery is core; an edition adds its connectors to the list through a web extension slot
  (Enterprise: payments, Shopify and its custom MCP connector, whose page is today's Enterprise Connectors).

## Decisions

| Item            | Decision                                                                                                                                                                                                                      | From                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Edition         | Core (Lite and Enterprise). A ready connector, not an MCP link.                                                                                                                                                               | Owner (2026-10-26)          |
| Sign-in         | Settings → Integrations → **Connect Google Calendar**: Google's own sign-in in a new window (OAuth, PKCE, our Google app, desktop client type), one Google account per install. Disconnect any time; events in Google stay.   | Owner ("no link"); our how  |
| Where it is set | The account in Settings → Integrations; per AI agent on its page, card **Bookings**: the calendar, two switches and the booking rules.                                                                                        | Our call                    |
| AI switches     | **Check free times** (on by default) and **Book appointments** (off by default, "Changes your calendar" badge). Booking needs free times on. Booking off: the AI offers free times and hands the chat to the team to book.    | Same rule as Enterprise #41 |
| Booking rules   | Calendar (writable calendars only), event title (+ customer name), length, days and hours, gap between bookings, earliest (hours from now), latest (days ahead). Times outside the rules or busy in that calendar never show. | Our call                    |
| Safety          | Server-enforced: the AI books only after the customer confirms one time in their own words; the slot is re-checked just before booking; the AI never cancels or moves a booking (hands over); Try it never books.             | Our call                    |
| Team visibility | The chat shows "AI checked free times · Google Calendar" and "AI booked Fri, 30 Oct, 7:30–9:00 pm · Google Calendar" lines (stored chat events).                                                                              | Our call                    |
| Failure         | Sign-in expired or Google unreachable: Settings and the agent page say so, the AI stops checking and booking and hands booking chats to the team; nothing is sent to customers about it.                                      | Our call                    |
| Data to Google  | The event holds the title, the customer's name and WhatsApp number and a note "Booked by the EzyChat AI"; no chat text. Tokens only in an encrypted setting; logs carry counts and ids, never times or names.                 | Our call                    |

## Screens and states (mock checklist)

- Admin → Connectors gallery: all, a category, no match, a connector needing attention, the Lite view (Enterprise
  badges).
- Google Calendar page: Overview (connected, sign-in expired, Google unavailable, not connected), Google sign-in
  (stand-in consent dialog), Disconnect + confirm; Settings (booking off / on, not connected); Activity.
- Coming soon pages with Vote (Google Sheets, AutoCount) and the Enterprise-only Custom connector page in Lite (Upgrade to Enterprise).
- Agent page → Connectors summary.
- Try it: free times offered ("AI checked free times"), customer picks a time → booking on: "AI would book …
  (Try it doesn't book)"; booking off: hand-over to the team.
- Chat: a booking conversation with the two calendar lines and the AI's replies.
- Desktop 1280 px and mobile 360 px touch, light and dark: `calendar-shots.mjs` (80 shots, no page errors, no
  horizontal overflow).

## Not in this round

- Cancel or move a booking by the AI (hands over).
- Several staff or rooms (Enterprise: per-staff calendars, other booking systems).
- Reminders before the booking, Google Meet links, Outlook calendar.
- Booking in group chats (direct chats only).

## Server plan (for the build, our call)

- `integrations/google-calendar/`: OAuth (PKCE, loopback redirect through the app's own callback route), tokens in
  an encrypted setting, Calendar REST API (free/busy, event insert) through a guarded fetch with timeouts.
- Table `agent_bookings` per agent (a numbered migration); two AI tools in `ai/agent/tools.ts`
  (`check_free_times`, `book_appointment`), offered only when switched on and connected; the booking tool takes a
  start time only, the server applies the rules, re-checks free/busy and writes the event; the chat event
  `ai_tool_used` carries the booking start and end.
- Google app verification (sensitive scope `calendar.events` + `calendar.freebusy`) starts when the owner
  confirms this mock; shared later with Google Sheets.

## Open questions for the owner

1. Booking off by default — or on once the admin connects?
2. Should the customer get a reminder message the day before (needs the send queue and a template on the Business API)?
3. Event text: is the WhatsApp number in the Google event OK?

## Confirmation

Confirmed by the owner 2026-10-26 ("Implement it") after the round 2–4 screenshots (gallery, Google Calendar page,
Lite view, business connectors with Vote, agent summary, Try it, booked chat); mock revision `f46aab9`.
Open questions without an answer take the defaults: **Book appointments off by default**; the event holds the
customer's name and WhatsApp number; **reminders are not in this round** (proposal: part of the Google Calendar
connector, see `docs/backlog.md`); the vote number `601159246128` is confirmed.
