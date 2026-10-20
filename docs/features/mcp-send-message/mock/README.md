# MCP send-message interactive app proposal

A clone of the owner-confirmed **simple-first-setup** reference (the whole app, git revision
`90a95dab`), with the UI for letting an admin's AI assistant send WhatsApp replies (server part:
`send_message`, scope `inbox:send`). New UI carries the **Proposed feature** badge. Scope, rules and
plan: [../design.md](../design.md).

From the repository root, after the normal `npm install`:

```powershell
# Seeded demo: admin aisyah / demo-pass-123, Kopi Apong chats, two access tokens.
npx tsx --conditions=ezychat-source docs/features/mcp-send-message/mock/run.ts --fake-wa
```

Open `http://localhost:7487/` (API on `127.0.0.1:7486`; override with `MOCK_UI_PORT` /
`MOCK_API_PORT`, never 7420). The servers bind to loopback and use a fresh temporary data folder.
The API is the real server of this branch, so the send rules are the real ones.

## Walkthrough

1. Sign in as `aisyah` / `demo-pass-123`.
2. **Admin → Settings → Integrations**, "Access tokens": the seeded token **Claude – office laptop**
   shows the **Can send** badge; **ChatGPT – reports only** has none (read-only).
3. **Create token**: the new checkbox **Can send WhatsApp messages** (off). Tick it: the warning
   "Replies go straight to your customers…" appears. Create the token: the list shows the badge.
4. **Back to inbox → Farah Aziz**: the reply the seeded assistant sent through the real
   `send_message` path shows **via AI assistant** next to its time.
5. The section texts no longer say that assistants can never send; they say they send only with a
   token that allows it.

The demo reply is sent at start by `seed.ts` through the real `InboxSendPort` (no AI client needed).
To try a real client, enable AI assistant access, create a token with the box ticked and connect it
to `http://127.0.0.1:7486/mcp` (see the connect steps after creating the token).

## Checks

```powershell
npx tsc -p docs/features/mcp-send-message/mock/tsconfig.json
node docs/features/mcp-send-message/mock/snapshot.mjs --check
# With the seeded mock running:
node docs/features/mcp-send-message/mock/send-shots.mjs
```

`send-shots.mjs` saves `screenshots/NN-<step>-<desktop|mobile>.png` (1280 px and 360 px) for the token
list, the dialog (off and ticked) and the chat line, and reports page errors and horizontal overflow.

The manifest (`reference.json`) records the baseline revision, the mechanical drift fixes needed to
build the old reference against today's packages (`baselineDriftFixes`) and the 9 files this
proposal changes. Do not run `snapshot.mjs` without `--check`: that replaces the reference with the
current app.
