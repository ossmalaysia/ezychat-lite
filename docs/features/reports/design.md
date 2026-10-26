# Reports (busy days, busy times, reply times)

Owner request 2026-10-26 ("can we look at basic analytics for ezychat lite? So we know how many basic info like
lead per day, and other useful data for small business", then "can we build chart or graph so we can see the busy
days?"). Today the numbers exist only for AI assistants through the MCP tool `get_stats`; the app has no screen
for them. This adds **Admin → Reports**. Status: **confirmed** 2026-10-26 (see Confirmation); next: implementation.

## Why

A small business owner wants to know, without exporting anything: how many new customers write each day, which
days and hours are busy (to plan staff), how fast the team and the AI answer, which customers were missed, and
why the AI hands chats over (what to add to the Business context). The owner's own inbox showed a chat waiting 7
days after an AI hand-off with nothing in the app pointing at it: Reports shows that number.

**No tracking in Lite** still holds: everything is counted from the local database on the owner's computer and
shown only there. Nothing is sent to us.

## Decisions

"Owner" = decided by the owner. "Our call" = proposed by the designer; the owner may change it.

| Topic                  | Decision                                                                                                                                                                                                                                                        | By       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Charts                 | Busy days must be visible as a chart.                                                                                                                                                                                                                           | Owner    |
| Where                  | **Admin → Reports**, the first item of the admin menu (the page an owner opens most).                                                                                                                                                                           | Our call |
| Who                    | **Admins only** (team performance and missed customers are owner information). Agents see nothing new.                                                                                                                                                          | Our call |
| Period                 | 7, 30 or 90 days (default 30), in the business time zone (`ai_timezone`, default Asia/Kuala_Lumpur), today partial. Each total shows the change against the period just before ("▲ 12% vs previous 30 days"); green/red follows better/worse, not up/down.      | Our call |
| Totals                 | New customers; messages from customers (and replies sent); median first reply time (team and AI); missed new customers; waiting after AI hand-off (count, oldest, **Open chats**); chats the AI answered (closed by the AI, handed to the team).                | Our call |
| Charts                 | Busy days (average messages from customers per weekday, Monday first, busiest highlighted, one-line finding); Busy times (weekday × hour heatmap, darker = more); messages from customers per day (weekends lighter, busiest day named); new customers per day. | Our call |
| Lists                  | Why the AI handed chats to the team (reasons, count and share; "Answer not in the Business context" links to the agent page); Team (chats, replies, median first reply per member, the AI agent as one row).                                                    | Our call |
| Drawing                | Plain HTML and SVG in the app's colour tokens, **no chart library** (a heatmap is not in Recharts anyway; keeps the bundle small; light/dark and 360 px under our control). Changed from the first suggestion (shadcn chart / Recharts).                        | Our call |
| Accessibility          | Every chart has **Show as table** with the same numbers; a readout line (`aria-live`) names the bar or square under the pointer or finger; phones show the table switch as an icon with its label for screen readers.                                           | Our call |
| Little data            | Under 14 days of messages: a note "Only N days of messages so far" and the busy-day/time findings say "Too early to tell" (patterns from a few days mislead).                                                                                                   | Our call |
| No data                | "No messages yet" card instead of empty charts.                                                                                                                                                                                                                 | Our call |
| Chats counted          | Direct chats only (groups are not customers); every inbox the admin can see. An inbox filter when 2+ inboxes (Enterprise) is a later round.                                                                                                                     | Our call |
| New customer           | The first message ever from a chat (alias-merged person) on that day. Chats that arrived through the WhatsApp **history import** are not new on the import day; the card says from which date it counts.                                                        | Our call |
| Missed new customer    | A new customer with no reply (team or AI) within **1 hour** of their first message. Fixed in this round.                                                                                                                                                        | Our call |
| First reply time       | Median minutes from a customer message that opens a conversation (a new chat, or the first message after the chat was resolved) to the first reply from the team or the AI.                                                                                     | Our call |
| Waiting after hand-off | Open chats whose last hand-off came from the AI and that have no teammate reply after it, the newest message being the customer's.                                                                                                                              | Our call |
| MCP                    | `get_stats` gets the same new numbers (new customers, missed, first reply, waiting after hand-off, weekday and hour averages), so an AI assistant reads what the page shows.                                                                                    | Our call |
| Not in Lite            | CSV export, scheduled e-mail reports and comparing inboxes side by side: candidates for Enterprise.                                                                                                                                                             | Our call |

## Questions for the owner (asked 2026-10-26; unanswered, so the proposals stand)

1. Admins only, or may agents see Reports too (maybe without the Team table)?
2. "Missed" after 1 hour: right for most shops, or should the admin set it?
3. The silent hand-off: Reports shows it. Do you also want a warning in the inbox itself (a separate small
   feature: a "Waiting after hand-off" filter and badge)?

## Server (our call; the builder may refine names)

- `GET /api/reports?days=7|30|90` (`requireAdmin`), zod schema in `packages/shared` first; counted by a new
  `reports/` module next to `chats/stats.ts` (reuses `localDate`/`localMidnight`, `inboxCondition` for the
  caller's inboxes); results cached ~60 s per (days, inbox scope).
- New column `chats.first_seen_at` (numbered migration): live inbound sets it once; existing chats get the
  timestamp of their earliest message; chats created by the history import are marked so they are not "new"
  on the import day. Extend `upgrade-from-oldest.test.ts`'s seed.
- Hour and weekday buckets use the business time zone; hours with no messages are 0, not missing.
- Logs: route, days, ms only.
- Speed (follow-up, PR #193): results are cached for 60 s per period, time zone and inbox scope
  (`cachedReport`), so numbers, the days around midnight and the "waiting after hand-off" count can be up to a
  minute old; counting uses per-chat index look-ups only for chats with messages in the period.

## Source baseline

- Feature **ai-phrase-dictionary**, path `docs/features/ai-phrase-dictionary/mock/`, `latestConfirmed` revision
  `db1df77f0821c978729f7d616762b5a00b67a8cb` (copied from the folder on `main` `027a03e`), without its
  `screenshots/`. The page was first drafted on the ai-reply-suggestions reference (`e7bf307`, commit `09c32a0`
  of PR #191); ai-phrase-dictionary was confirmed on `main` meanwhile, so the same Reports files were moved onto it
  unchanged before implementation. `snapshot.mjs --check` verifies the frozen app files and the inherited files.
- Reused: `AdminLayout` nav and phone menu, `PageHeader`, `SegmentedControl`, `Card`, `Banner`, `ErrorState`,
  `Skeleton`, `Select`, the token colours (`primary` with opacity steps, `warning`, `danger`, `success`), the
  hand-off reason list of `get_stats` and the inbox event texts.

## Mock

- Run (Node 22 or later): `npx tsx --conditions=ezychat-source docs/features/reports/mock/run.ts --fake-wa`, then
  `http://localhost:7485/admin/reports` (API `7484`). Sign in as `aisyah` / `demo-pass-123`. Walkthrough:
  `mock/README.md`.
- Effects: `mock/reports.ts` stands in for the future route with seeded demo numbers shaped like a small
  Malaysian shop (Friday busiest, quiet weekends, late-morning and evening peaks): `GET /api/mock/reports?days=`,
  `GET`/`PUT /api/mock/reports/scenario` (4 months, new install 5 days, no messages, slow, error). Browser
  side: `src/mock/reports.ts`.
- Screenshots: `node docs/features/reports/mock/reports-shots.mjs` (desktop 1280 / mobile 360 touch, light /
  dark, 11 states) into `mock/screenshots/`; it reports page errors and horizontal scroll (none).
- Screen-review fixes during the mock: phones show the table switch as an icon so titles keep their width;
  table numbers do not wrap; a tap keeps its readout on touch (the pointer leaving after a tap no longer
  clears it); "0%" reads "Same as previous N days"; findings say "Too early to tell" under 2 weeks.

## Screen and state checklist

| Area        | States                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| Page        | 30 days (01), 90 days (02), 7 days (03); admin menu with Reports on a phone (07)                              |
| Charts      | day readout by pointer / tap (04), hour readout (05), Show as table (06)                                      |
| Data states | 5 days of messages with the notes (08), no messages yet (09), loading (10), error with Retry (11)             |
| Totals      | change vs previous (up/down, better/worse colours, "same"), missed (warning), waiting after hand-off (danger) |
| Widths      | desktop 1280, mobile 360; light and dark                                                                      |

## Changed and added files (mock)

- Changed (listed in `reference.json` `proposalChanged`): `src/admin/AdminLayout.tsx` (nav item and route),
  `src/i18n/locales/{en,ms,zh-CN}/admin.json` (`mockReports.*`, English in all three).
- Added: `src/admin/ReportsPage.tsx`, `src/admin/ReportCharts.tsx`, `src/mock/reports.ts`, `reports.ts`,
  `reports-shots.mjs`.
- Runner: `proposal.ts` registers `reports.ts`; `run.ts` ports 7485/7484 and the temp-folder name.

## Retention

This is the 6th feature folder, so the oldest, `send-reactions` (creation order 10), is removed in the same
change; its last revision stays in `mock-index.json` (`archived`). (The first draft removed `emoji-reactions`,
which `main` had already removed for ai-phrase-dictionary.)

## Confirmation

Owner viewed the screenshots (30 days desktop and phone, 90 days dark, 5 days of data, no messages yet) and
confirmed 2026-10-26 ("look fine, implement it"). The three questions were not answered, so the proposals stand:
**admins only**, **missed = no reply within 1 hour (fixed)**, and the inbox warning for chats waiting after a
hand-off is **not part of this feature** (a separate small feature later).

Reference revision `ce56468` (`mock-index.json` → `latestConfirmed`).
