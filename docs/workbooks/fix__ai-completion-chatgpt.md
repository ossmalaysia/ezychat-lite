# Workbook: fix/ai-completion-chatgpt

Branch: `fix/ai-completion-chatgpt` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | skip | Behaviour fix inside the confirmed ai-reply-suggestions design; design.md rows updated (timing, context, fast model) | 149b5b9 | 2026-10-26 |
| Dev | done | Fast draft model (ChatGPT gpt-6-luna, reasoning low; API gpt-4.1-mini; Claude haiku) for suggestions and completions; completion without knowledge (last 6 messages); type-through and half-word trigger in the composer; drop reason and timedOut in the ai_draft log | 149b5b9 | 2026-10-26 |
| Unit tests | pass | Changed-file tests: server reply-suggestion tests 61/61, web Composer 39/39, shared 6/6; typecheck server + web clean; lint clean | 149b5b9 | 2026-10-26 |
| E2E | pass | npm run e2e --workers=1: 90 passed, 0 failed, 16 skipped; e2e:electron-links 16/16 | 149b5b9 | 2026-10-26 |
| Dev Build | pass | Owner test env 7491 with the owner's ChatGPT sign-in: gpt-6-luna completions 1.3-2.2 s; person-like typing check: grey text at once in 2 of 4 cases after type-through (was never shown on the installed 0.1.58) | 149b5b9 | 2026-10-26 |
| Screen review | skip | No new or changed screen element; the grey text looks the same | 149b5b9 | 2026-10-26 |

## Log

- 2026-10-26 Dev: done — Fast draft model (ChatGPT gpt-6-luna, reasoning low; API gpt-4.1-mini; Claude haiku) for suggestions and completions; completion without knowledge (last 6 messages); type-through and half-word trigger in the composer; drop reason and timedOut in the ai_draft log (149b5b9)
- 2026-10-26 Dev Build: pass — Owner test env 7491 with the owner's ChatGPT sign-in: gpt-6-luna completions 1.3-2.2 s; person-like typing check: grey text at once in 2 of 4 cases after type-through (was never shown on the installed 0.1.58) (149b5b9)
- 2026-10-26 E2E: pass — npm run e2e --workers=1: 90 passed, 0 failed, 16 skipped; e2e:electron-links 16/16 (149b5b9)
- 2026-10-26 Unit tests: pass — Changed-file tests: server reply-suggestion tests 61/61, web Composer 39/39, shared 6/6; typecheck server + web clean; lint clean (149b5b9)
- 2026-10-26 Design: skip — Behaviour fix inside the confirmed ai-reply-suggestions design; design.md rows updated (timing, context, fast model) (149b5b9)
- 2026-10-26 Screen review: skip — No new or changed screen element; the grey text looks the same (149b5b9)
