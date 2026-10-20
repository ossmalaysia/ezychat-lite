# Token permissions interactive app proposal

A clone of the owner-confirmed **mcp-send-message** reference (the whole app, git revision
`b3a5479b`), with the UI for changing what an existing access token may do: turn sending on or off,
and messaging new numbers, without creating a new token. Scope, rules and plan:
[../design.md](../design.md).

From the repository root, after the normal `npm install`:

```powershell
# Seeded demo: admin aisyah / demo-pass-123, Kopi Apong chats, three access tokens.
npx tsx --conditions=ezychat-source docs/features/token-permissions/mock/run.ts --fake-wa
```

Open `http://localhost:7487/` (API on `127.0.0.1:7486`; override with `MOCK_UI_PORT` /
`MOCK_API_PORT`, never 7420). The servers bind to loopback and use a fresh temporary data folder.
The API is the real server of this branch, so the permission rules are the real ones.

## Walkthrough

1. Sign in as `aisyah` / `demo-pass-123`.
2. **Admin → Settings → Integrations**, "Access tokens": each token of yours has a **Permissions**
   button next to **Revoke**.
3. **Claude – office laptop → Permissions**: "Can send WhatsApp messages" is ticked (as the token is
   now). Tick **Can also message new numbers**: the red "Risk of a WhatsApp ban" warning appears.
   **Save**: the list shows the **New numbers** badge at once, and the token's assistant gets
   `send_to_new_number` on its next request. Nothing to reconnect.
4. **ChatGPT – reports only → Permissions**: tick **Can send WhatsApp messages** to let a read-only
   token reply; untick it again to take the right away. **Save** stays off until something changed.
5. The other screens are the confirmed mcp-send-message reference, unchanged.

## Checks

```powershell
npx tsc -p docs/features/token-permissions/mock/tsconfig.json
node docs/features/token-permissions/mock/snapshot.mjs --check
# With the seeded mock running:
node docs/features/token-permissions/mock/perm-shots.mjs
```

`perm-shots.mjs` saves `screenshots/NN-<step>-<desktop|mobile>.png` (1280 px and 360 px) for the token
list, the Permissions dialog (as opened and with new numbers ticked) and the saved state, and reports
page errors and horizontal overflow.

The manifest (`reference.json`) records the baseline revision, the earlier drift fixes and the files
this proposal changes or adds. Do not run `snapshot.mjs` without `--check`: that replaces the
reference with the current app.
