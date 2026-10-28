# Fix English (grammar fix in the composer): interactive app proposal

A clone of the owner-confirmed **ai-groups** reference (the whole app, `latestConfirmed` revision `ea63248f`, cloned
unchanged from `main` 8a3f44f) with the **grammar-fix** proposal on top: while a teammate types an English reply, the
AI underlines spelling (red) and grammar (blue) mistakes; hover or tap a word to fix it, or **Fix 5** / **Ctrl+J** to
fix all, with Undo. Scope, research, rules and the screen checklist: [../design.md](../design.md).

Every inherited flow still works (AI in groups, connectors, Reports, Google Calendar, reply suggestions, phrase list,
reactions, inboxes, AI agents). Mock-only control texts are English in all three catalogs; the new user-facing texts
(`mockGrammar.*`) have Malay and Chinese.

From the repository root, after the normal `npm install` (Node 22 or later):

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/grammar-fix/mock/run.ts --fake-wa
```

Open `http://localhost:7489/` (API on `127.0.0.1:7488`; `MOCK_UI_PORT` / `MOCK_API_PORT` change them). The seed
takes about a minute. Nothing calls WhatsApp, OpenAI, Anthropic, Google or a partner: the runner blocks every
outside request. The checker is a stand-in (`grammar.ts`, routes `/api/mock/grammar*`): a fixed list of common typos
and grammar slips answered after 700 ms, so every state can be shown without a model.

## Walkthrough

1. Sign in as `aisyah`, open **Farah Aziz** and type:
   `Hi Farah, your order have been ship. pls check you email for a update.`
   After a short pause five words are underlined and **✨ Fix 5** (desktop: with `Ctrl J`) appears at the end of the
   row under the box.
2. Desktop: hover **have** → the card "Grammar · ~~have~~ → **has** · Ignore". Click **has**. Phone (or a touch
   emulator): tap the word for the same card with large buttons and a close button.
3. Click **Fix 4** (or press **Ctrl+J**): the text becomes "…has been shipped. Please check your email for an update."
   and "4 fixed · **Undo**" shows for 5 seconds. Undo brings the draft back.
4. Type a correct sentence: "✓ No mistakes". Type `Boleh, saya check dulu ya.`: nothing is checked (Malay).
5. Try a price and Manglish: `i will sent the invoice for RM480 tommorow lah` — RM480 and "lah" are never touched.
6. Hover a word and click **Ignore**: that fix is hidden for the rest of the draft.
7. **Admin → Settings → AI → Fix English** (under Phrase list): the team switch, cost and rules text. The dashed
   **Mock only** box: **Install** New / Updated (switch off + note), **AI answer** Normal / Slow (checking spinner) /
   Error / Connection expired ("Fix English unavailable" in the composer).

## Changed for this proposal

Reference: `reference.json` keeps the frozen baseline hashes (`inheritedUnchanged` now also pins the ai-groups
proposal's files) and lists this proposal under `proposalChanged` / `proposalAdded`.

- Changed (frontend): `src/inbox/Composer.tsx` (marks layer, card, Fix button, Ctrl+J, Undo),
  `src/admin/SettingsPage.tsx` (the card under Phrase list), and the `en`, `ms`, `zh-CN` `admin.json` / `inbox.json`
  catalogs (`mockGrammar.*`).
- Added (frontend): `src/inbox/GrammarFix.tsx` (check hook, marks, card, button), `src/admin/GrammarFixSection.tsx`
  (Settings card and Mock only box), `src/mock/grammar.ts` (client of the stand-in routes, `shiftIssues`,
  `applyIssues`).
- Runner: `grammar.ts` (added: stand-in checker and routes), `proposal.ts` (registers it), `run.ts` (temp-folder name,
  ready line), `grammar-shots.mjs` (added), every `*-shots.mjs` usage line, `reference.json`.

Not shown: the real model (the stand-in knows a fixed list of mistakes), the rate limit, logging.

## Checks

```powershell
npx tsc -p docs/features/grammar-fix/mock/tsconfig.json
node docs/features/grammar-fix/mock/snapshot.mjs --check
# With the seeded mock running (fresh browser contexts; light and dark, 1280 px and 360 px touch; installed
# Chrome unless PW_CHROMIUM is set).
node docs/features/grammar-fix/mock/grammar-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app. The other
`*-shots.mjs` scripts are inherited (pointed at this mock's port).
