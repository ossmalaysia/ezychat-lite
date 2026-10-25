# WhatsApp Business API inboxes: interactive app proposal (Enterprise)

A clone of the owner-confirmed **upgrade-enterprise** reference (the whole app, `latestConfirmed` revision
`2fce4a7`), with a second inbox type, the **WhatsApp Business API** (Meta Cloud API), in the Enterprise view:
Admin → Inboxes (type choice, Meta form, webhook over Phone access, Edit/Replace token), the setup wizard's
WhatsApp step, the 24-hour reply window and Send a template in the conversation. Scope, decisions and the
screen checklist: [../design.md](../design.md). Mock-only texts are English in all three catalogs.

From the repository root, after the normal `npm install`:

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/business-api/mock/run.ts --fake-wa
# First launch (setup wizard):
npx tsx --conditions=ezychat-source docs/features/business-api/mock/run.ts --fake-wa --fresh
```

Open `http://localhost:7487/` (API on `127.0.0.1:7486`). Nothing calls WhatsApp, Meta, OpenAI or Anthropic:
the runner blocks every outside request; Meta's checks are simulated.

## Walkthrough

1. Sign in as `aisyah`. Open **Admin → Inboxes**: the third inbox, **Online orders**, is a Business API
   number. With Phone access off it says **Turn on Phone access to receive messages**.
2. Open **Phone access**, start a Quick Tunnel (simulated), then back to Inboxes: **Receiving messages** with
   the webhook address. Phone access shows a note naming the Business API inbox.
3. **Add inbox** → **WhatsApp Business API**: name, who can open it, then the Meta details. Open **Where do I
   find these?**. Any IDs of 6+ digits work; a token containing `expired`/`bad` is rejected, otherwise
   **Check and connect** connects the number and shows its business name, quality and limit.
4. **Edit** the Business API inbox: Meta connection, **Replace token**, and the dashed **Mock only** buttons
   (token rejected, webhook failing).
5. Inbox → **Priya Nair** (Online orders): "Reply window: 6 h … left" above the composer. **Mock: close the
   window** closes it.
6. **Jason Lim**: the window has closed; the composer is replaced by **Send a template**. Pick
   `order_update`, fill the variables, see the preview, **Send template**. The bubble says "Template
   order_update". **Simulate the customer's reply** opens the window again.
7. With `--fresh`: create the admin, then the WhatsApp step asks **How do you connect WhatsApp?**: the QR scan
   (default) or **Business API**.
8. Switch **Mock view** to **Lite** (Admin → Members, or `?edition=lite`): no Business API inbox, type, window
   or template anywhere.

Reset the demo data: restart the runner and use a fresh browser profile (state is in localStorage
`mock.businessApi.inboxes.v1`).

## Checks

```powershell
npx tsc -p docs/features/business-api/mock/tsconfig.json
node docs/features/business-api/mock/snapshot.mjs --check
# With the seeded mock running (fresh browser contexts; light and dark, 1280 px and 360 px):
node docs/features/business-api/mock/business-api-shots.mjs
# With a --fresh mock on other ports (MOCK_UI_PORT=7479 MOCK_API_PORT=7478):
node docs/features/business-api/mock/business-api-shots.mjs http://localhost:7479 --setup
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
`upgrade-shots.mjs`, `send-reaction-shots.mjs`, `reaction-shots.mjs`, `agent-shots.mjs` and `inbox-shots.mjs`
are inherited scripts (pointed at this mock's port).
