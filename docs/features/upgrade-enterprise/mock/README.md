# Upgrade to Enterprise interactive app proposal

A clone of the owner-confirmed **send-reactions** reference (the whole app, `latestConfirmed` revision
`82c8419`), with "Upgrade to Enterprise" links in the Lite view: Admin → Members, the AI agent limit page,
Admin → WhatsApp, the account menu (admins) and the About dialog. Each opens `https://ezychat.ai/#enterprise`
in a new tab. Scope, decisions and the screen checklist: [../design.md](../design.md). Mock-only texts are
English in all three catalogs.

From the repository root, after the normal `npm install`:

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/upgrade-enterprise/mock/run.ts --fake-wa
```

Open `http://localhost:7485/?edition=lite` (API on `127.0.0.1:7484`). Nothing calls WhatsApp, OpenAI or
Anthropic: the runner blocks every outside request.

## Walkthrough

1. Sign in as `aisyah`. Open **Admin → Members**: the note "Need more AI agents?" shows with **Upgrade to
   Enterprise**. Switch **Mock view** to **Enterprise**: the note goes away. Switch back to **Lite**.
2. Open `http://localhost:7485/admin/members/ai/new?preset=faq`: the limit page shows **Upgrade to
   Enterprise** beside **Back to Members**.
3. Open **Admin → WhatsApp**: the Connection card shows "Need more WhatsApp numbers?" with the button.
4. Open the account menu (the avatar): **Upgrade to Enterprise** is after **Admin settings**.
5. Select **About EzyChat Lite**: the text and the button are under **View on GitHub**.
6. Sign in as `daniel` (agent) in a private window: the account menu has no upgrade item; About still has it.

## Checks

```powershell
npx tsc -p docs/features/upgrade-enterprise/mock/tsconfig.json
node docs/features/upgrade-enterprise/mock/snapshot.mjs --check
# With the seeded mock running (fresh browser contexts; light and dark, 1280 px and 360 px):
node docs/features/upgrade-enterprise/mock/upgrade-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
`send-reaction-shots.mjs`, `reaction-shots.mjs`, `agent-shots.mjs` and `inbox-shots.mjs` are inherited scripts
(pointed at this mock's port).
