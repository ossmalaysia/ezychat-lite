# Multi-inbox interactive app proposal

A clone of the owner-confirmed **token-permissions** reference (the whole app, git revision `58346c1f`),
with several WhatsApp numbers as **inboxes**, each linked with the WhatsApp app on its phone (QR scan, as
today). Scope, screen review and open questions: [../design.md](../design.md). English only.

From the repository root, after the normal `npm install`:

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123), two inboxes.
npx tsx --conditions=ezychat-source docs/features/multi-inbox/mock/run.ts --fake-wa
```

Open `http://localhost:7487/` (API on `127.0.0.1:7486`). The inbox data is mock-only and lives in this
browser (localStorage): a new browser or a private window starts from the seed again.

## Walkthrough

1. Sign in as `aisyah` (admin). The list shows every chat with its **inbox chip** (Kopi Apong, Catering)
   and an **All inboxes (2)** filter.
2. Open **Nurul Huda**: the header shows the inbox (Catering); replies leave from that number.
3. **Admin → Inboxes**: both numbers, their status and who can open them. **Add inbox**: a name, **Save**,
   then the QR code; **Simulate the scan** links the phone. **Edit** renames an inbox or shows the QR code
   again (**Link the phone again**).
4. **Admin → Members**: **Inbox access** per agent; **Edit** on Daniel ticks inboxes.
5. Sign out, sign in as `meiling` (agent with Catering only): only Catering chats, no filter, no chips.
   Open `/chats/60128814455%40s.whatsapp.net` (a Kopi Apong chat): "You cannot open this chat".

## Checks

```powershell
npx tsc -p docs/features/multi-inbox/mock/tsconfig.json
node docs/features/multi-inbox/mock/snapshot.mjs --check
# With the seeded mock running:
node docs/features/multi-inbox/mock/inbox-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
