# Fix English (grammar fix in the composer)

Status: **proposal**, waiting for owner confirmation. Branch `claude/compassionate-euler-tpgs37` from `main` (`8a3f44f`).

## Owner request (2026-10-28)

- "when i type english, alway have typo, can i have more easy way to auto correct grammer issue? suggest how it will
  show? in mobile and desktop".
- The first proposal (a preview panel with Apply / Keep mine) was "not easy to use"; the owner asked to research how
  Grammarly does it, then agreed to the Grammarly-style proposal ("ok go ahead").

## Research (2026-10-28)

| Tool                          | How it shows                                                                          | How you fix                                         |
| ----------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Grammarly (browser extension) | Underlines while you type; a counter at the field's bottom-right                      | Hover the word, click the card; counter = full list |
| Grammarly keyboard (mobile)   | Clear-cut typos corrected automatically with a note in the bar; others as suggestions | One tap accept / dismiss                            |
| Gboard Proofread (Android)    | A **Fix it** button                                                                   | One tap applies all, **Undo** next to it            |
| Apple Writing Tools           | Changes applied and underlined in place                                               | Undo or revert to the original                      |
| Intercom inbox (AI Compose)   | ⌘J / Ctrl J → Fix grammar & spelling                                                  | Accept, undo, try again                             |

Sources: support.grammarly.com (browser extension guide, suggestions list), support.google.com/gboard/answer/14164531,
support.apple.com/guide/mac-help/mchldcd6c260, intercom.com/help/en/articles/6955446 and its 2023 changelog.

What they share, and this proposal keeps: the mistake is marked **in the text**, fixing is **one tap**, **Undo**
replaces a confirm step, and nothing shows when there is nothing wrong.

## Baseline

- Cloned from the owner-confirmed **ai-groups** mock (`latestConfirmed`, revision
  `ea63248ff0e7a529c95978a5ac82af464e5e0d70`), the whole app; `main` 8a3f44f has no change to it outside screenshots.
  The baseline screenshots are not copied (git history keeps them).
- Reused, not changed: the composer (`Composer.tsx`: the grey completion layer drawn over the box, the Accept pill on
  touch, Quick replies / Suggest reply row), Settings → AI cards (Reply suggestions, Phrase list), the fast "Model for
  suggestions", the draft checks (`ai/draft-check.ts`: numbers not in the source are refused).
- The desktop app keeps its own spell-check (red underline + right-click words, `apps/desktop/src/context-menu.ts`);
  Fix English uses its own dictionary so the result is the same in the browser, the desktop app and phones; the
  desktop's native spell-check is turned off on the composer only (`spellCheck={false}`) so words are not marked twice.
- Retention: new feature folder (6th); the oldest, `ai-phrase-dictionary` (last revision on `main` `8a3f44f`), is
  pruned in the same change (git history keeps it).

## Round 2 (2026-10-28): dictionary for spelling, AI for grammar

The owner asked where the English comes from and chose **option B** ("b is ok") over AI only: spelling from a
built-in dictionary in the browser (instant, free, offline, works without AI), grammar from the AI after a pause,
plus a **team word list**. Size checked on npm 2026-10-28: `dictionary-en-gb` 3.0.0 (Hunspell en-GB, 49,602 entries,
MIT AND BSD) 552 KB `index.dic` + 3 KB `index.aff`, 190 KB gzipped; `nspell` 2.1.5 (MIT) 42 KB unpacked. Total about
0.6 MB on disk, about 0.2 MB to download, once, only while Fix English is on.

## Behaviour (proposal)

| Rule          | Default                                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Switch        | Settings → AI → **Fix English**, team-wide. On for a new install, off after an update (with a note). Works **without an AI connection** (spelling only, with a note); grammar needs the connection.                                                                                                                       |
| Spelling      | **On every key, in the browser**: `nspell` + `dictionary-en-gb` (British spelling: colour, cancelled), loaded lazily the first time someone types while the switch is on, cached by the browser. No AI, no server call, no text leaves the device. The word still being typed is left alone until a space or punctuation. |
| Grammar       | **700 ms after the teammate stops typing**: one request to the "Model for suggestions" (fast model) with the whole draft, grammar only. Typing makes no request; a new pause cancels the old one.                                                                                                                         |
| What it marks | Wavy underline + light tint: **red = spelling** (instant), **blue = grammar** (after the pause). A spelling mark wins over a grammar mark on the same word. Text in the box never changes by itself.                                                                                                                      |
| Fix one       | Desktop: hover the word → card "~~have~~ → **has**" with Ignore. Phone: tap the word → same card, large buttons. Click/tap the fix.                                                                                                                                                                                       |
| Unknown word  | A word the dictionary does not know (product, place, customer word): card "Not in the dictionary" with **Add to team words** and Ignore; not counted in Fix all.                                                                                                                                                          |
| Team words    | Never marked. Seeded from the agents' Business context (words the dictionary does not know, e.g. Kopi Apong, nasi lemak, Bayan Lepas); any teammate adds from the card; admins add and remove in Settings → AI. At most 500 words, 40 characters, no numbers or links.                                                    |
| Fix all       | The **✨ Fix 5** button at the end of the composer's bottom row, or **Ctrl+J / ⌘J**. Then "5 fixed · **Undo**" for 5 s (or until typing).                                                                                                                                                                                 |
| No mistakes   | A quiet "✓ No mistakes" in the same place.                                                                                                                                                                                                                                                                                |
| Ignore        | Hides that mark for the rest of this draft.                                                                                                                                                                                                                                                                               |
| Never changed | Numbers, prices, dates, order ids, links, names; a word touching a digit is never marked; a grammar fix that adds or removes a digit is dropped. The teammate's tone stays (lah, ya, ok).                                                                                                                                 |
| Languages     | English only. Chinese/Tamil script or two or more Malay words: not checked, nothing shown.                                                                                                                                                                                                                                |
| Where         | Every chat the teammate can write in (direct and groups), every user (not only admins).                                                                                                                                                                                                                                   |
| AI down       | Spelling keeps working; a short "Grammar check unavailable" (tooltip: the connection needs attention). Sending is never blocked.                                                                                                                                                                                          |
| Cost          | Spelling free. Grammar: one short request per pause; nothing stored, logs carry counts only.                                                                                                                                                                                                                              |
| Send          | Never changes the text on Send. What is in the box is what goes out.                                                                                                                                                                                                                                                      |

Proposed API for the app (not built): `POST /api/chats/:jid/ai/fix-grammar` {text} → `{ status: 'checked', issues:
[{start, end, original, replacement, kind: 'grammar'}] } | { status: 'skipped', reason }` (rate-limited per user, 120 a
minute); `GET /api/fix-english/words`, `POST /api/fix-english/words` {word} (any user, audited), `DELETE
/api/fix-english/words/:word` (admins, audited); `PUT /api/ai/fix-english` {enabled} for admins; state in the
bootstrap payload. The server keeps the grammar guards (numbers, links, language). Dictionary files ship with the web
build as static assets (no CDN), loaded with a dynamic import; if a first load is slow on old phones, move the
check into a Web Worker.

## Screens (mock checklist)

0. Spelling marked at once, before the pause (only "pls", no grammar yet) — `00-spelling-at-once`.
1. Composer with spelling and grammar marks and **Fix 5** (desktop 1280, phone 360, light/dark) — `01-underlines`.
2. Card over one word: hover (desktop), tap (phone) — `02-card`.
3. One word fixed (4 left) — `03-one-fixed`.
4. Fix all → "5 fixed · Undo"; Undo brings the draft back; Ctrl+J on desktop — `04-fixed-undo`.
5. No mistakes — `05-no-mistakes`.
6. Malay message: not checked — `06-malay-not-checked`.
7. Long draft over three lines, seven marks incl. one-letter "i" / "a"; RM480, "lah", and the team words nasi lemak
   and Bayan Lepas untouched — `07-long-draft`.
8. AI connection expired: spelling still marked and fixable, "Grammar check unavailable" — `08-grammar-unavailable`.
9. Settings → AI → Fix English: new install (on), updated install (off + note) — `09`, `10`.
10. Unknown word "cendol": card with Add to team words; after adding it the mark goes — `11-unknown-word`.
11. Team words in Settings (Business context words, added by a teammate, add field, remove) — `12-team-words`.

## Not in this round

- Auto-correct without a tap (Grammarly keyboard style) — risk of changing a customer reply unseen.
- Rewrite / tone change ("make it polite"), translation.
- Personal (per-user) word lists and a per-user switch.
- Malay or Chinese spelling and grammar.

## Open questions for the owner

1. Lite (free, like Reply suggestions) or Enterprise-only? Proposal: **Lite** (AGENTS.md: free features go to Lite).
2. On by default for new installs? Proposal: **yes**, off after an update with a note.

## Confirmation

Not confirmed yet.
