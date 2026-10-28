# Fix English (grammar fix in the composer): interactive app proposal

A clone of the owner-confirmed **ai-groups** reference (the whole app, `latestConfirmed` revision `ea63248f`, cloned
unchanged from `main` 8a3f44f) with the **grammar-fix** proposal on top: while a teammate types an English reply, the
spelling mistakes are underlined at once in red (a dictionary in the browser, no AI) and grammar mistakes in blue after
a short pause (the AI); hover or tap a word to fix it, or **Fix 5** / **Ctrl+J** to fix all, with Undo. Words the
dictionary does not know go to a team word list. Scope, research, rules and the screen checklist: [../design.md](../design.md).

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
outside request. Both checkers are stand-ins so every state shows the same way each time: spelling
(`src/mock/spelling.ts`, in the browser) knows a fixed list of typos and Malaysian words in place of `nspell` +
`dictionary-en-gb`; grammar (`grammar.ts`, routes `/api/mock/grammar*`) knows a fixed list of grammar slips and answers
after 700 ms in place of the fast model. The team word list lives in the runner (`/api/mock/grammar/words`).

## Walkthrough

1. Sign in as `aisyah`, open **Farah Aziz** and type:
   `Hi Farah, your order have been ship. pls check you email for a update.`
   **pls** turns red as soon as you type the space after it (spelling, no AI). After a short pause four grammar
   words turn blue and **✨ Fix 5** (desktop: with `Ctrl J`) appears at the end of the row under the box.
2. Desktop: hover **have** → the card "Grammar · ~~have~~ → **has** · Ignore". Click **has**. Phone (or a touch
   emulator): tap the word for the same card with large buttons and a close button.
3. Click **Fix 4** (or press **Ctrl+J**): the text becomes "…has been shipped. Please check your email for an update."
   and "4 fixed · **Undo**" shows for 5 seconds. Undo brings the draft back.
4. Type a correct sentence: "✓ No mistakes". Type `Boleh, saya check dulu ya.`: nothing is checked (Malay).
5. Try a price and Manglish: `i will sent the invoice for RM480 tommorow lah` — RM480 and "lah" are never touched.
6. Hover a word and click **Ignore**: that fix is hidden for the rest of the draft.
7. Type `Hi Farah, the cendol is RM4 today. `: **cendol** is red ("Not in the dictionary"). Hover or tap it and press
   **Add to team words**: the mark goes, for the whole team. "nasi lemak", "Bayan Lepas", "Kopi Apong" are never
   marked: they came from the Business context.
8. Mock only → AI answer **Connection expired**: spelling is still marked and fixable, with "Grammar check
   unavailable".
9. **Admin → Settings → AI → Fix English** (under Phrase list): the team switch, cost and rules text. The dashed
   **Mock only** box: **Install** New / Updated (switch off + note), **AI answer** Normal / Slow (checking spinner) /
   Error / Connection expired ("Grammar check unavailable" in the composer). Below the switch: **Team words** (from
   Business context, added by a teammate, add field, remove).

## Changed for this proposal

Reference: `reference.json` keeps the frozen baseline hashes (`inheritedUnchanged` now also pins the ai-groups
proposal's files) and lists this proposal under `proposalChanged` / `proposalAdded`.

- Changed (frontend): `src/inbox/Composer.tsx` (marks layer, card, Fix button, Ctrl+J, Undo, Add to team words,
  native `spellCheck` off while Fix English marks spelling),
  `src/admin/SettingsPage.tsx` (the card under Phrase list), and the `en`, `ms`, `zh-CN` `admin.json` / `inbox.json`
  catalogs (`mockGrammar.*`).
- Added (frontend): `src/inbox/GrammarFix.tsx` (check hook, marks, card, button), `src/admin/GrammarFixSection.tsx`
  (Settings card, Team words, Mock only box), `src/mock/grammar.ts` (client of the stand-in routes, `shiftIssues`,
  `applyIssues`), `src/mock/spelling.ts` (stand-in for the browser dictionary).
- Runner: `grammar.ts` (added: stand-in grammar checker, team word list and routes), `proposal.ts` (registers it), `run.ts` (temp-folder name,
  ready line), `grammar-shots.mjs` (added), every `*-shots.mjs` usage line, `reference.json`.

Not shown: the real dictionary and model (the stand-ins know fixed lists), loading the dictionary, the rate limit,
logging.

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
