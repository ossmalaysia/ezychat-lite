# Google Calendar connector interactive app proposal

A clone of the owner-confirmed **ai-phrase-dictionary** reference (the whole app, `latestConfirmed` revision
`db1df77`), with a ready **Google Calendar** connector: Settings → Integrations → **Connect Google Calendar**
(no link to paste), a **Bookings** card on the AI agent page (calendar, Check free times, Book appointments,
booking hours and rules), Try it with free times and "AI would book", and a chat where the AI booked a table.
Scope, decisions and the screen checklist: [../design.md](../design.md). Mock-only texts are English in all
three catalogs.

From the repository root, after the normal `npm install` (Node 22 or later):

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/google-calendar/mock/run.ts --fake-wa
```

Open `http://localhost:7489/` (API on `127.0.0.1:7488`). Nothing calls Google, WhatsApp, OpenAI or Anthropic:
the runner blocks every outside request; Google is a stand-in (`google-calendar.ts`).

## Walkthrough

1. Sign in as `aisyah`. Open **Lim Mei Ying**: "AI checked free times · Google Calendar", the AI's offer, the
   customer's choice, then "AI booked Fri, … 7:30–9:00 pm · Google Calendar" and the AI's confirmation.
2. **Admin → Settings → Integrations**: the Google Calendar card (account, Working, calendars). The dashed
   **Mock only** box: **Sign-in expired** (Sign in again) and **Google unavailable**. **Disconnect** (confirm),
   then **Connect Google Calendar**: the stand-in Google sign-in, **Allow**.
3. **Admin → Members → Aina → Bookings**: the calendar, **Check free times** (on), **Book appointments** (off
   by default, "Changes your calendar"), event title, length, days and hours, gap, earliest and latest booking,
   the "Always" rules, **Save bookings**. Disconnected: the card asks to connect first.
4. **Try it** on the same page: ask "Can I book a table for 4?": "AI checked free times" and three free times.
   **Customer picks the first time**: with booking on, "AI would book … (Try it doesn't book)"; with booking off,
   a hand-over to the team.

## Checks

```powershell
npx tsc -p docs/features/google-calendar/mock/tsconfig.json
node docs/features/google-calendar/mock/snapshot.mjs --check
# With the seeded mock running (fresh browser contexts; light and dark, 1280 px and 360 px touch):
node docs/features/google-calendar/mock/calendar-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
`phrase-shots.mjs`, `suggest-shots.mjs`, `business-api-shots.mjs`, `upgrade-shots.mjs`, `send-reaction-shots.mjs`,
`reaction-shots.mjs`, `agent-shots.mjs` and `inbox-shots.mjs` are inherited scripts (pointed at this mock's port).
