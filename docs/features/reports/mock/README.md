# Reports interactive app proposal

A clone of the owner-confirmed **ai-phrase-dictionary** reference (the whole app, `latestConfirmed` revision
`db1df77`), with a new **Admin → Reports** page: busy days, busy times, messages and new customers per day,
reply times, the AI's hand-off reasons and the team. Scope, decisions and the screen checklist:
[../design.md](../design.md). Mock-only texts are English in all three catalogs.

From the repository root, after the normal `npm install` (Node 22 or later):

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/reports/mock/run.ts --fake-wa
```

Open `http://localhost:7485/admin/reports` (API on `127.0.0.1:7484`). Nothing calls WhatsApp, OpenAI or
Anthropic. The report numbers are seeded demo data (the same on every reload), not counted from the demo
chats: the future server counts them from the database.

## Walkthrough

1. Sign in as `aisyah`. **Admin** opens with **Reports** first in the menu.
2. Switch **7 days / 30 days / 90 days**. The six totals show the change against the period before.
3. **Busy days**: Friday stands out. **Busy times**: point at a square (tap on a phone) for the average.
4. **Messages from customers per day**: point at or tap a bar; weekends are lighter; the busiest day is
   named until you pick another.
5. **Show as table** on any chart shows the same numbers as rows.
6. **Waiting after AI hand-off** → **Open chats**; **Add the missing answers to the Business context** opens the
   AI agent page.
7. **Mock only → Demo data**: **New install, 5 days** (too-early notes), **No messages yet**, **Slow** (loading),
   **Error** (Retry).
8. Sign in as `daniel` (agent): there is no Admin, so no Reports.

## Checks

```powershell
npx tsc -p docs/features/reports/mock/tsconfig.json
node docs/features/reports/mock/snapshot.mjs --check
# With the seeded mock running (fresh browser contexts; light and dark, 1280 px and 360 px touch):
node docs/features/reports/mock/reports-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app. The other
`*-shots.mjs` scripts are inherited (they default to their own feature's port; pass this mock's URL).
