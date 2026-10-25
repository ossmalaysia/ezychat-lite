# Workbook: feat/ai-reply-suggestions

Branch: `feat/ai-reply-suggestions` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Owner confirmed the mock 2026-10-26 ("ok"); latestConfirmed e7bf307 | e7bf307 | 2026-10-25 |
| Dev | done | Tasks 1-9 of docs/superpowers/plans/2026-10-26-ai-reply-suggestions.md; fresh-reviewer findings fixed (7) | e54623c | 2026-10-25 |
| Unit tests | pass | CI green on 2c77735: Linux (tests + coverage gates + changed lines 98.1 %), Windows, macOS | e54623c | 2026-10-25 |
| E2E | pass | npm run e2e on e54623c+: 90 passed, 0 failed, 16 skipped; reply-suggestions.spec on desktop, mobile, iphone; e2e:electron-links green in CI (Windows) | e54623c | 2026-10-25 |
| Dev Build | pass | Mock model: e2e/devbuild-suggestions-check.mjs 9/9 on e54623c; real-model 15-chat check not run (needs owner sign-in and agreement) | e54623c | 2026-10-25 |
| Screen review | done | 20 real-app shots (1280/360, light/dark) via e2e/reply-suggestions-screens.mjs match the confirmed mock; no findings; docs/screenshots/chat + ai-settings refreshed | e54623c | 2026-10-25 |

## Log

- 2026-10-25 Design: doing — Design docs/features/ai-reply-suggestions/design.md (owner answers 2026-10-25) + interactive mock on business-api 078de13; screenshots sent 2026-10-26; waiting for owner confirmation (61e6bb9)
- 2026-10-25 Design: done — Owner confirmed the mock 2026-10-26 ("ok"); latestConfirmed e7bf307 (e7bf307)
- 2026-10-25 Dev: done — Tasks 1-9 of docs/superpowers/plans/2026-10-26-ai-reply-suggestions.md; fresh-reviewer findings fixed (7) (e54623c)
- 2026-10-25 Unit tests: pass — CI green on 2c77735: Linux (tests + coverage gates + changed lines 98.1 %), Windows, macOS (e54623c)
- 2026-10-25 Dev Build: pass — Mock model: e2e/devbuild-suggestions-check.mjs 9/9 on e54623c; real-model 15-chat check not run (needs owner sign-in and agreement) (e54623c)
- 2026-10-25 Screen review: done — 20 real-app shots (1280/360, light/dark) via e2e/reply-suggestions-screens.mjs match the confirmed mock; no findings; docs/screenshots/chat + ai-settings refreshed (e54623c)
- 2026-10-25 E2E: pass — npm run e2e on e54623c+: 90 passed, 0 failed, 16 skipped; reply-suggestions.spec on desktop, mobile, iphone; e2e:electron-links green in CI (Windows) (e54623c)

## Implementation rulings

Decisions the executor took during the build (from the plan ledger), each with its cost if wrong.

- Pre-flight: Ruling: label trimming keeps the result ≤ 40 characters including `…` — T1's schema caps at 40 — cost if wrong: a parse error on long labels.
- Pre-flight: Ruling: 409/503 use `new HttpError(409, 'ai_suggestions_off', …)` and `new HttpError(503, 'ai_unavailable', …)` — the plan's Global Constraints name these codes — cost if wrong: the web shows a generic error.
- Task 1: Ruling: test at packages/shared/src/reply-suggestions.test.ts, not packages/shared/test/ — shared tests live beside the source — cost if wrong: none (same runner)
- Task 2: Ruling: setReplySuggestions audits only a real change (no row when the value stays) — an audit row per no-op save is noise — cost if wrong: one missing no-op audit row; actor.userId typed number|null for start-up callers
- Task 3: Ruling: DRAFT_RULES adds two lines to the plan's copy (WhatsApp formatting; 'where the safety rules say hand over, return noAnswer') — drafts go to WhatsApp and GUARDRAILS says hand over — cost if wrong: Markdown in drafts / contradictory rule text
- Task 3: Ruling: DraftOutput/CompletionOutput live in draft-prompt.ts (re-exported from draft-check.ts); prompt.ts exports situationClock and administratorInstructions (live prompt unchanged, prompt.test.ts green) — cost if wrong: none
- Task 3: Ruling: buildDraftPrompt takes handoffRules: string | undefined (undefined = defaults, as businessHandoffRules) and adds currentSituation.task — cost if wrong: none
- Task 4: Ruling: AiProvider.draft(settings, apiKey, prompt, options: { schema, fast, maxOutputTokens }, signal) — the plan split schema and options; one options object keeps the call short — cost if wrong: a rename in Task 5
- Task 4: Ruling: fast-model choice is the pure draftModelSettings(settings, fast) and DRAFT_FAST_MODELS.api is a literal guarded by a test against OPENAI_DEFAULT_MODEL — importing provider.ts from agent/draft.ts would make an import cycle — cost if wrong: none (guard test)
- Task 5: Ruling: AiService also gets draftConnection(): 'ready'|'unavailable'|'none' (signed_out/signing_in or no key = none; expired/error/closing = unavailable) — Task 6 status needs the saved-vs-working split — cost if wrong: wrong button state
- Task 5: Ruling: a failed suggestion call throws 503 ai_unavailable 'The AI could not suggest a reply. Try again.' (client abort rethrows); a failed or slow completion returns { completion: null } — the composer shows an error strip only for Suggest reply — cost if wrong: silent suggestion failures
- Task 5: Ruling: completion bound is a setTimeout AbortController (3,000 ms), not AbortSignal.timeout — fake timers can test it — cost if wrong: none
- Task 5: Ruling: 'no agent' test unbinds the agent with UPDATE ai_agents SET inbox_id = NULL — Lite blocks unbinding and deleting its only agent — cost if wrong: none (same lookup as Enterprise)
- Task 5: Ruling: draft sources = selected business knowledge + conversation + customer JSON (Internal items excluded; the leak check covers them) — cost if wrong: an Internal number in a draft is dropped
- Task 6: Ruling: PUT /api/ai/reply-suggestions uses requireAdmin as its preHandler and no post-await recheck — the handler never yields (sync setting write) — cost if wrong: none
- Task 6: Ruling: the completion body is parsed before the rate limit (an invalid body is 400 and does not count) — cost if wrong: none
- Task 6: Ruling: status read route is GET /api/reply-suggestions (not /api/ai/…); PUT stays /api/ai/reply-suggestions and is in ai-routes-access.test.ts — that test enforces 'every /api/ai route is admin-only' — later tasks (8, 9) use these paths — cost if wrong: one path rename
- Task 7: Ruling: the check runs on port 7495, not the plan's 7491 — 7491 is the owner's permanent hand-test Dev Build (AGENTS.md) — cost if wrong: none
- Task 7: Ruling: Lite cannot show a 404 for an agent without inbox access (one inbox = everyone); the check covers groups (400), the switch (409) and the Internal-item drop instead; the 404 stays covered by reply-suggestions-routes.test.ts (two inboxes) — cost if wrong: none
- Task 8: Ruling: Composer makes no query; Conversation reads useReplySuggestionsStatus and passes aiSuggest.state ('on'|'unavailable', null = off) — existing Composer tests render without a QueryClient — cost if wrong: none
- Task 8: Ruling: REPLY_COMPLETION_READY fixed to /[\p{L}\p{N}][\s,.!?;:，。？！、]+$/u — 'Hi Nurul, ' (comma + space) was not a boundary under the plan's regex (test added RED→GREEN) — cost if wrong: completions after punctuation would never start
- Task 8: Ruling: tests in a new file Composer.suggest.test.tsx (not appended to Composer.test.tsx); the admin 'Add it to Business context' link goes to /admin/members/ai (redirects to the agent) — cost if wrong: none
- Task 9: Ruling: catalog keys settings.replySuggestions.* with real ms and zh-CN texts; card has no 'Proposed' badge or mock controls — cost if wrong: none
- Final: Ruling: reviewer's declined items (completion cost per pause, products as grounded, Tab capture, 60 s status staleTime, Lite 404 not in Dev Build, sync PUT without recheck, mock out of scope) stand — each is in the spec or an earlier ruling; the server still enforces 409 when the switch is off — cost if wrong: a stale button for up to 60 s
- Final: Ruling: npm run lint fails only on untracked .claude/worktrees copies (tsconfigRootDir parse errors); eslint . --ignore-pattern '.claude/**' → 0 problems; CI lints a clean checkout — cost if wrong: none
- Final: Ruling: pack-contract failure was a stale local dist (pre-016); after npm run build:core it passes 21/21 and ships migration 020 — cost if wrong: none

## Deferred minor findings (final review)

- ghost overlay does not follow textarea scroll on messages taller than 160 px
- one needless completion call after a chip pick when the draft ends with . or ?
- rate limit counts before the 404 access check
