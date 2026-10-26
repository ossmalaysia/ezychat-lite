# Google Calendar connector (AI checks free times and books)

Status: **proposal**, waiting for the owner's confirmation.
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

- Settings → Integrations → Google Calendar: not connected (what it does, Connect), Google sign-in (stand-in
  consent dialog), connected (account, Working, calendars with Read only, link to the agent, Disconnect + confirm),
  sign-in expired (Sign in again), Google unavailable.
- Agent page → Bookings: not connected (Connect), connected with booking off, booking on, paused (expired /
  unavailable banner), Save bar.
- Try it: free times offered ("AI checked free times"), customer picks a time → booking on: "AI would book …
  (Try it doesn't book)"; booking off: hand-over to the team.
- Chat: a booking conversation with the two calendar lines and the AI's replies.
- Desktop 1280 px and mobile 360 px touch, light and dark: `calendar-shots.mjs` (44 shots, no page errors, no
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

Not yet confirmed.
