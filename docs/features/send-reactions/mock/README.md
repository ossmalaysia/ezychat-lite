# Send emoji reactions interactive app proposal

A clone of the owner-confirmed **emoji-reactions** reference (the whole app, as on `feat/emoji-reactions` at
`988db65`), where the **team reacts** to messages from EzyChat: a 🙂 button beside each bubble, an emoji bar,
the shared reaction of the linked WhatsApp number and the names in the reaction list. Scope, decisions and the
screen checklist: [../design.md](../design.md). Mock-only texts are English in all three catalogs; the app
texts are translated.

From the repository root, after the normal `npm install`:

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/send-reactions/mock/run.ts --fake-wa
```

Open `http://localhost:7483/` (API on `127.0.0.1:7482`). Reactions go out through the fake WhatsApp phone
(mock-only route `POST /api/mock/react`), come back as the app's normal `message:reactions` event and are
stored. Nothing calls WhatsApp, OpenAI or Anthropic: the runner blocks every outside request.

## Walkthrough

1. Sign in as `aisyah` and open **Farah Aziz**. Move the pointer over "Can I book catering…": the 🙂 button
   shows next to the Reply button. Click it: the bar shows 👍 ❤️ 😂 😮 😢 🙏 and **+**.
2. Click 👍: the badge shows under the message. Click the badge: the list says "You" with **Remove**.
3. Open the bar again: 👍 is highlighted and the note says to select it again to remove it. Click **+** for
   40 more emojis; **‹** goes back.
4. In a second browser (private window) sign in as `meiling` (assigned to Farah's chat). The list says
   "Aisyah (team)", and the bar says Mei Ling's choice replaces Aisyah's: the team shares one reaction.
5. Open **Simulate reactions from WhatsApp** and select **WhatsApp goes offline**: the bar's emojis are disabled
   with a warning. **WhatsApp is back** enables them. **Phone reacts** replaces the team's reaction with the
   phone's one ("You (phone)").
6. At the phone width (360 px, touch emulation), press and hold a message: the bar opens with a **Reply** row.
   Swipe right still replies.
7. Keyboard: Tab to a message's 🙂 button (it shows on focus), Enter opens the bar, Escape closes it.

## Checks

```powershell
npx tsc -p docs/features/send-reactions/mock/tsconfig.json
node docs/features/send-reactions/mock/snapshot.mjs --check
# With the seeded mock running (fresh browser contexts; light and dark, 1280 px and 360 px):
node docs/features/send-reactions/mock/send-reaction-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
`reaction-shots.mjs`, `agent-shots.mjs` and `inbox-shots.mjs` are inherited scripts (pointed at this mock's port).
