# Google Calendar connector interactive app proposal

A clone of the owner-confirmed **ai-phrase-dictionary** reference (the whole app, `latestConfirmed` revision
`db1df77`), with a **connector gallery** (Admin → Connectors) and a ready **Google Calendar** connector with its own page
(Overview, Settings, Activity; sign in with Google, no link to paste), a Connectors summary on the AI agent page,
Try it with free times and "AI would book", and a chat where the AI booked a table.
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

1. Sign in as `aisyah`. **Admin → Connectors**: the gallery (Google Calendar under Your connectors; Google
   Sheets, HitPay, Shopify, Custom connector). Try the category chips and the search. Add `?edition=lite` to the
   address for the Lite view (HitPay and Shopify show Enterprise).
2. Open **Google Calendar**: **Overview** (what it does, what the AI can do, the Google account, Your data; the
   dashed **Mock only** box shows Sign-in expired and Google unavailable; **Disconnect**, then **Connect Google
   Calendar** for the stand-in Google sign-in), **Settings** (calendar, Check free times, Book appointments off by
   default, booking rules, Save bookings), **Activity**.
3. **Admin → Members → Aina**: the **Connectors** summary row opens the Settings tab. **Try it**: ask "Can I book
   a table for 4?" → free times; **Customer picks the first time** → "AI would book …" or a hand-over.
4. Open the chat **Lim Mei Ying**: "AI checked free times" and "AI booked …" lines with the AI's replies.

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
