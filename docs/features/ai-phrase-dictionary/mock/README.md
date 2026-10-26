# AI phrase list interactive app proposal

A clone of the owner-confirmed **ai-reply-suggestions** reference (the whole app, `latestConfirmed` revision
`e7bf307`), with the composer behaviour of the speed fix (PR #188) and two additions: an AI-built **phrase list**
that gives instant grey text (matched in the browser on every key, no model call), and the **Model for
suggestions** choice in Settings → AI. Scope, decisions and the screen checklist: [../design.md](../design.md).
Mock-only texts are English in all three catalogs.

From the repository root, after the normal `npm install` (Node 22 or later):

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/ai-phrase-dictionary/mock/run.ts --fake-wa
```

Open `http://localhost:7489/` (API on `127.0.0.1:7488`). Nothing calls WhatsApp, OpenAI or Anthropic: the
runner blocks every outside request; the phrases and the drafts are canned.

## Walkthrough (phrase list)

1. Sign in as `aisyah`. Open **Nurul Huda** and type `Thank you for ` (with the space): the rest of the phrase
   shows in grey at once. Type `Our open`: the half-typed word finishes ("ing hours are 8am to 10pm daily.").
   Press **Tab** (or tap **Accept suggestion**): the phrase counts up in the list.
2. Open **Siti Rahman** and type `Terima kasih `, or **Tan Wei Jie** and type `谢谢您`: Malay and Chinese phrases.
3. Type `Hi Nurul! Two Nasi `: no phrase matches, so the fast model answers after about 1.5 s.
4. Open **Admin → Settings → AI**. **Reply suggestions → Model for suggestions**: Fast (recommended), Same as the
   AI agent, or one model. **Phrase list**: the count per language, the last update and the next one,
   **View phrases** (search, language filter, add, edit, delete) and **Rebuild now** (a 2 s simulated build). The
   dashed **Mock only** box shows the empty, building and error states. Turn Reply suggestions off: the card says
   the list does not update and Rebuild is disabled.

## Walkthrough (inherited reply suggestions)

1. Sign in as `aisyah`. Open **Nurul Huda** and press **Suggest reply**: two chips show after a short wait.
   Tap one: the full draft fills the composer. Edit it and press Send as usual.
2. Type `Hi Nurul, sure`, press **Suggest reply** again and tap a chip: "Replace your text with this
   suggestion?" asks first. **Keep my text** keeps it.
3. Clear the box and type `Hi Nurul! Two Nasi ` (with the space). After a short pause the end of the
   sentence shows in grey. Press **Tab** (or tap **Accept suggestion** on a phone); **Esc** dismisses it.
4. Open **Ahmad Zulkifli** (Hari Raya hours are not in the business context): "No answer in the business
   context." with a link for admins. **Priya Nair** (order problem): the hand-off rule note, no draft.
   **Jason Lim**: one chip only. **Tan Wei Jie** and **Siti Rahman**: Chinese and Malay drafts.
5. Open **Admin → Settings → AI**, card **Reply suggestions**: the switch, the cost note and the dashed
   **Mock only** box. **AI answer**: Slow (loading), Error (Try again), Connection expired (the button is
   disabled with "AI suggestions are not available now"). **Install → Updated install**: the switch starts off
   with the "New: reply suggestions" note. Turn the switch off and save: the button goes away in the inbox.
6. Sign in as `daniel` (agent) in a private window: the same button and chips; the "No answer" note has no
   admin link.

## Checks

```powershell
npx tsc -p docs/features/ai-phrase-dictionary/mock/tsconfig.json
node docs/features/ai-phrase-dictionary/mock/snapshot.mjs --check
# With the seeded mock running (fresh browser contexts; light and dark, 1280 px and 360 px touch):
node docs/features/ai-phrase-dictionary/mock/phrase-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
`suggest-shots.mjs`, `business-api-shots.mjs`, `upgrade-shots.mjs`, `send-reaction-shots.mjs`, `reaction-shots.mjs`, `agent-shots.mjs` and `inbox-shots.mjs`
are inherited scripts (pointed at this mock's port).
