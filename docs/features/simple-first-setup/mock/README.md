# Simple first-time setup interactive app proposal

A full clone of the owner-confirmed Customer enrichment reference (which includes the whole app),
with the first-run journey simplified: a four-step setup wizard (Account → WhatsApp → AI assistant →
Ready), a Getting started card on the empty inbox, an inline AI connection on the Sales Agent page,
a tidier Settings → AI and "Phone access" instead of "Cloudflare". New UI carries the
**Proposed feature** badge. See [../design.md](../design.md) for scope, decisions and checks.

From the repository root, after the normal `npm install`:

```powershell
# Fresh install: no users, WhatsApp waiting for a QR scan, AI not connected. Opens on /setup.
npx tsx docs/features/simple-first-setup/mock/run.ts --fake-wa --fresh

# Seeded demo (as in earlier mocks): admin aisyah / demo-pass-123, Kopi Apong chats.
npx tsx docs/features/simple-first-setup/mock/run.ts --fake-wa
```

Open `http://localhost:7487/` (API on `127.0.0.1:7486`; override with `MOCK_UI_PORT` /
`MOCK_API_PORT`, never 7420). Both servers bind to loopback and use a fresh temporary data folder,
so restart the runner to repeat the fresh-install journey. External requests are blocked.

## Walkthrough (fresh mode)

1. **Account**: type a business name (e.g. Kopi Apong), your name (the username fills in as
   `aisyah.rahman`) and one password (the eye icon shows it). Continue.
2. **WhatsApp**: the QR code appears as in the app. Click **Demo: simulate scanning the code**
   (mock only), or use the Phone number tab: the mock links 6 s after the pairing code is shown.
   Continue.
3. **AI assistant**: fill in the prefilled "About your business" template. Click
   **Sign in with ChatGPT** (simulated: "Signing in…" for 2.5 s, then "Connected to ChatGPT").
   Or **Use an OpenAI API key instead** → **Test key**: a key starting `sk-` (10+ characters)
   passes and is saved; anything else shows an error. Leave **Turn on the AI assistant now** on and
   click **Finish** (or **Skip for now**).
4. **Ready**: summary, Add teammates / Use on phones outside this Wi-Fi, **Go to inbox**.
5. Inbox: the **Getting started** card lists what is left (finished items are hidden; × hides it).
6. Admin → Members → the AI member: business text saved as a Business context item, AI on,
   **Try it** answers from that text (e.g. "How much is a Teh Tarik?"). Instructions and hand-off
   rules sit under the closed **Advanced** section.
7. Settings → AI: ChatGPT first and recommended, **Set up the Sales Agent** link, **Test key**
   for API keys, Voice messages and Customer enrichment under **More AI features**. Signing out
   here shows the inline **Connect the AI** card on the Sales Agent page.
8. Admin → **Phone access** (the former Cloudflare page, same route `/admin/tunnel`).

Try it and live replies use a deterministic demo answer (the Business context line sharing the
most words with the question, else a hand-off); no model is called. ChatGPT sign-in, the API-key
test, WhatsApp linking, Cloudflare and push are simulated in `run.ts` / `proposal.ts` only.

## Checks

```powershell
npx tsc -p docs/features/simple-first-setup/mock/tsconfig.json
node docs/features/simple-first-setup/mock/snapshot.mjs --check
# With the fresh mock running (one fresh server per viewport; setup runs once per install):
node docs/features/simple-first-setup/mock/walkthrough.mjs --only=desktop
node docs/features/simple-first-setup/mock/walkthrough.mjs --only=mobile
```

`walkthrough.mjs` walks the whole journey, saves `screenshots/NN-<step>-<viewport>.png`, counts
clicks/fields from first launch to the AI being on and reports page errors and horizontal overflow.
Set `PW_CHROMIUM` to a Chromium executable if Playwright's bundled browser is not downloaded.

The manifest pins the 0.1.34 app source hashes, the confirmed baseline revision, the inherited
enrichment files (which must stay unchanged) and the 13 files this proposal changes plus 3 it adds.
Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
