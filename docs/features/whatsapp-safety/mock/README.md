# WhatsApp Safety: interactive app proposal

A clone of the owner-confirmed **ai-handoff-rules** reference (the whole app, `latestConfirmed` revision `16a126ec`)
with the **whatsapp-safety** proposal on top: incoming messages are checked by local rules and, when something looks
off, by the AI (fast model). Risky files get a warning in the chat, High-risk files are locked for agents, and admins get
**Admin → Safety**: who sent what, why it was flagged, who on the team downloaded it, report, block and settings. Scope
and checklist: [../design.md](../design.md).

From the repository root, after the normal `npm install` (Node 22 or later):

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/whatsapp-safety/mock/run.ts --fake-wa
```

Open `http://localhost:7489/`, sign in as `aisyah`.

## Walkthrough (this proposal)

1. **Inbox → Accounts Dept** (new number): red banner "Don't open this file", two reasons and the AI's one line; the
   ZIP shows "Locked for your team. Tap to check." Tap it: "High-risk file", Download is recorded.
2. Sign in as `daniel` (agent), same chat: the file shows a lock, "Locked for safety. Ask an admin." Tapping it is
   refused and appears in the Safety report.
3. **Jason Lim** (existing customer, same lure): the bar "This customer's WhatsApp may be hacked" with **Copy warning**.
   He is not blocked even with auto-block on.
4. **Maybank2u** (fake bank link, text only) and **Priya Nair** (spreadsheet with macros, a yellow "Check").
5. **Admin → Safety**: counts (to review, files locked, numbers blocked); the list shows name, number, new or existing
   customer, the main reason and who downloaded. **All** also shows Siti's normal payment question, cleared by the AI.
6. Open a row: what they sent (and the files inside the ZIP), why (each rule and the AI check), your team (downloads
   and refused tries), history; actions Mark safe (optionally trust the sender), Report as scam (block, how to report
   on the linked phone, NSRC 997, Cyber999), Unlock file for team, Delete file, Open chat.
7. **Settings**: Check incoming messages, AI check, Auto-block new numbers (off), Delete locked files after 7/30/90
   days, and the Enterprise "Check files and links online" row. Each technical setting has a "?" tip.
8. Turn on Auto-block, then in the dashed **Mock only** box press "ZIP lure from a new number": a toast says it was
   blocked automatically, **Blocked** lists it with Unblock, and the chat shows the blocked bar. "ZIP from a known
   customer" is flagged but never blocked.

```powershell
node docs/features/whatsapp-safety/mock/snapshot.mjs --check
node docs/features/whatsapp-safety/mock/safety-shots.mjs   # PW_CHROMIUM=<chrome> when Playwright's Chromium is missing
```

Everything below is the inherited ai-handoff-rules README; every inherited flow still works.

---

# AI hand-off rules fixes (Closing chats per agent): interactive app proposal

A clone of the owner-confirmed **concept-tips** reference (the whole app, `latestConfirmed` revision `360d3be5`) with
the **ai-handoff-rules** proposal on top: each AI agent page gets a **Closing chats** card with one switch, **Ask if the
question is answered**. Off (the sales default) the agent adds no "Does that answer your question?" line and never
closes a chat; on, it asks and closes only on a clear "yes". Scope and checklist: [../design.md](../design.md).

From the repository root, after the normal `npm install` (Node 22 or later):

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/ai-handoff-rules/mock/run.ts --fake-wa
```

Open `http://localhost:7489/`, sign in as `aisyah`.

## Walkthrough (this proposal)

1. **Admin → Members → AI agent** (Aina, sales): below Connectors, the **Closing chats** card with **Proposed**. The
   switch is off: "Aina adds no check-in line and never closes a chat. Your team closes chats."
2. The dashed **Mock only** box shows the same two customer messages: "Do you sell H100 GPUs? Where are you based?" →
   an answer with a discovery question and no check-in line; "yes we are in Malaysia" → the conversation goes on
   ("The chat stays open.").
3. Switch it on: the hint explains the resolution question, the first answer ends with "Does that answer your
   question?", and "yes we are in Malaysia" still continues ("A "yes" with new facts keeps the chat open").
4. Reload: the switch stays as you left it (kept per agent in this browser).

```powershell
node docs/features/ai-handoff-rules/mock/snapshot.mjs --check
node docs/features/ai-handoff-rules/mock/resolution-shots.mjs   # PW_CHROMIUM=<chrome> when Chrome is not installed
```

Everything below is the inherited concept-tips README; every inherited flow still works.

---
