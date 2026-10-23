# Images from customers interactive app proposal

A clone of the owner-confirmed **emoji-reactions** reference (the whole app, as on `feat/emoji-reactions` at
`988db65`), with a new card in Settings → AI: **Images from customers**, where an admin chooses how large customer
images reach the AI (Detailed, the default, or Fast). Scope and decisions: [../design.md](../design.md). Mock-only
state stays in the browser; the app texts are translated.

From the repository root, after the normal `npm install`:

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/ai-image-detail/mock/run.ts --fake-wa
```

Open `http://localhost:7481/` (API on `127.0.0.1:7479`). Nothing calls WhatsApp, OpenAI or Anthropic.

## Walkthrough

1. Sign in as `aisyah`, open **Admin → Settings → AI** and open **More AI features**.
2. **Images from customers** shows **Detailed** selected (the default) and **Fast**.
3. Select **Fast**: the toast says the setting is saved; reload the page and it stays.
4. Select **Claude API key** in the AI card and save it with any text as the key (the mock never sends it):
   the image card shows the note that Claude always reads images in detail.
5. Check the phone width (360 px) and dark mode.

## Checks

```powershell
npx tsc -p docs/features/ai-image-detail/mock/tsconfig.json
node docs/features/ai-image-detail/mock/snapshot.mjs --check
# With the seeded mock running:
node docs/features/ai-image-detail/mock/image-detail-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
