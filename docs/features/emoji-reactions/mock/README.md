# Emoji reactions interactive app proposal

A clone of the owner-confirmed **claude-provider** reference (the whole app, as on `main` at `21d9718`), with
**emoji reactions** in the conversation: a small badge under the corner of a bubble (inbound and outbound),
several different emojis grouped with the total, and a tap/click list of who reacted with which emoji. The
team cannot react yet (receive and show only). Scope, decisions and the screen checklist:
[../design.md](../design.md). English only for the mock-only texts (the ms and zh-CN catalogs carry the
English text); the app texts are translated.

From the repository root, after the normal `npm install`:

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/emoji-reactions/mock/run.ts --fake-wa
```

Open `http://localhost:7485/` (API on `127.0.0.1:7484`). Reactions come from the fake WhatsApp phone through
the dev route `POST /api/dev/fake-reaction` (fake WhatsApp only), so they are stored and pushed live as the
app does. Nothing calls WhatsApp, OpenAI or Anthropic: the runner blocks every outside request.

## Walkthrough

1. Sign in as `aisyah`. Open **Farah Aziz**: the assistant's reply has Farah's 👍 under its right corner.
   Click (tap) it: the list names "Farah Aziz" (her customer profile name).
2. Open **Jason Lim**: the question has 🙏 under its left corner; the list says "You (phone)" (the linked
   phone reacted).
3. Open **Kopi Apong Regulars** (group): the message shows 👍😋❤️ and 4; the list shows each member, the long
   name truncates, the phone's ❤️ is "You (phone)".
4. In any chat open **Simulate reactions from WhatsApp** (mock-only panel above the messages), choose **Last
   customer message** or **Last reply**, then:
   - direct chat: **Customer reacts 👍**, **Customer changes to ❤️** (the badge changes live),
     **Customer removes it** (the badge goes away), **Phone reacts** / **Phone removes it**;
   - group: **One member reacts**, **7 members react** (three emojis and the count 7, a long name),
     **Phone reacts**, **Remove all**.
5. Check the phone width (360 px) and dark mode: the badge stays inside the bubble column, the list fits the
   screen and long names truncate.

## Checks

```powershell
npx tsc -p docs/features/emoji-reactions/mock/tsconfig.json
node docs/features/emoji-reactions/mock/snapshot.mjs --check
# With the seeded mock running (fresh browser contexts; light and dark, 1280 px and 360 px):
node docs/features/emoji-reactions/mock/reaction-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
`agent-shots.mjs` and `inbox-shots.mjs` are the inherited custom-agents and multi-inbox scripts (pointed at this
mock's port).
