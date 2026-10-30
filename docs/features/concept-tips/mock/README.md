# Concept tips ("?" next to new words): interactive app proposal

A clone of the owner-confirmed **grammar-fix** reference (the whole app, `latestConfirmed` revision `4a6cde77`,
cloned unchanged from `main` 2ea78a9) with the **concept-tips** proposal on top: a small **?** beside every label or
title that names a concept a non-technical owner may not know (API key, model, Business context, hand-over, phone
access, LAN, MCP, access token, connectors…). Click or tap it: a short card says what it is in one or two sentences,
with one row of actions: the outside page where the thing is made (OpenAI and Anthropic key pages), **Show steps**
(folded numbered steps, API keys only) and **Full guide** (the ezychat.ai guide in the app language). Round 2 cut the
text to about a third after the owner's "too many text". Scope, the
screen review and the open questions: [../design.md](../design.md).

Every inherited flow still works (Fix English, AI in groups, connectors, Reports, Google Calendar, reply suggestions,
phrase list, reactions, inboxes, AI agents).

From the repository root, after the normal `npm install` (Node 22 or later):

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/concept-tips/mock/run.ts --fake-wa
# First launch (setup wizard): no users, WhatsApp waiting for a QR scan, AI not connected.
npx tsx --conditions=ezychat-source docs/features/concept-tips/mock/run.ts --fresh --fake-wa
```

Open `http://localhost:7489/` (API on `127.0.0.1:7488`; `MOCK_UI_PORT` / `MOCK_API_PORT` change them). Nothing
calls WhatsApp, OpenAI, Anthropic, Google or a partner: the runner blocks every outside request. The tip cards are
static text; their outside links open in a new tab.

## Walkthrough

1. **First launch** (`--fresh`): create the account. On **Link your WhatsApp number** press **?**: linked device
   like WhatsApp Web, the phone keeps the number, open WhatsApp every 14 days.
2. **Skip** to **AI assistant**: **?** beside **About your business** and beside **Connect the AI** (EzyChat has no
   AI of its own; ChatGPT sign-in is the easiest).
3. **Use an OpenAI API key instead** → **?** beside **OpenAI API key**: what a key is, **Get a key at OpenAI**,
   **Show steps** (4 short steps), **Full guide**. **Use a Claude API key instead** shows the Anthropic version.
4. **Seeded demo**, sign in as `aisyah` → **Admin → Settings → AI**: **?** beside **AI**, the key (Replace key),
   the model (Advanced: choose a model) and **Voice messages** (under More AI features).
5. **Settings → General → LAN access**, **Settings → Integrations → AI assistant access** and **Access tokens**.
6. **Members → Aina** (AI agent): **?** beside **Business context**, **Try it**, **Role** and **Hand-over rules**
   (under Advanced).
7. **Phone access** and **Connectors**: one **?** each.
8. Every card closes with Esc or a click outside; on a phone it fits the screen and scrolls when long.

## Changed for this proposal

Reference: `reference.json` keeps the frozen baseline hashes and lists this proposal under `proposalChanged` /
`proposalAdded`.

- Added (frontend): `src/components/app/InfoTip.tsx` (the **?** button and card, Radix Popover, 44 px hit area,
  card capped at the space on screen), `src/lib/tips.ts` (each topic's shape: steps, note, outside page, guide).
- Changed (frontend): `src/admin/adminUi.tsx` (`Field` takes `tip`), the screens that show a tip
  (`AiQuickConnect`, `AiConnectionSection`, `AiVoiceSection`, `AgentPage`, `AgentContextPanel`, `SettingsPage`,
  `IntegrationsSection`, `TunnelPage`, `ConnectorsGalleryPage`, `setup/WaLinkStep`, `setup/AiAssistantStep`) and the
  `en`, `ms`, `zh-CN` `common.json` catalogs (`mockTips.*`, written by `tips-copy.mjs`).
- Runner: `run.ts` temp-folder name and ready line; `tips-copy.mjs` and `tips-shots.mjs` added.

## Checks

```powershell
npx tsc -p docs/features/concept-tips/mock/tsconfig.json
node docs/features/concept-tips/mock/snapshot.mjs --check
# Seeded mock on 7489 (Chromium; set PW_CHROMIUM to use a downloaded one):
node docs/features/concept-tips/mock/tips-shots.mjs http://localhost:7489 seeded
# A NEW fresh mock (it walks the account step once), e.g. MOCK_UI_PORT=7479 MOCK_API_PORT=7478:
node docs/features/concept-tips/mock/tips-shots.mjs http://localhost:7479 fresh
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app. The other
`*-shots.mjs` scripts are inherited (pointed at this mock's port).
