# Workbook: Live translate (web)

Branch: `claude/live-translate-web` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | todo |  |  |  |
| Dev | done | Live translate web: api/live-translate.ts, inbox/LiveTranslate.tsx, bubble/header/composer/list wiring, Settings → AI card, Account My language; i18n en/ms/zh-CN | a09e3a9 | 2026-11-19 |
| Unit tests | done | web: 1899 passed (166 files); new: LiveTranslate, ConversationTranslate, live-translate hooks, LiveTranslateSection, MyLanguageField | 3eb40f24 | 2026-11-19 |
| E2E | doing | e2e/live-translate.spec.ts green alone on desktop, Pixel 7, iPhone 14 with the six routes answered in the browser; full npm run e2e waits for the server PR | 3eb40f24 | 2026-11-19 |
| Dev Build | todo |  |  |  |
| Screen review | todo | waits for the server PR: screens.smoke, 1280/360 light/dark against the confirmed mock | 3eb40f2 | 2026-11-19 |

## Log

- 2026-11-19 Dev: done — Live translate web: api/live-translate.ts, inbox/LiveTranslate.tsx, bubble/header/composer/list wiring, Settings → AI card, Account My language; i18n en/ms/zh-CN (a09e3a9)
- 2026-11-19 E2E: todo — e2e/live-translate.spec.ts written and green alone on desktop, Pixel 7, iPhone 14 with the five routes answered in the browser; the full npm run e2e waits for the server PR (a09e3a9)
- 2026-11-19 Unit tests: done — web: 1899 passed (166 files); new: LiveTranslate, ConversationTranslate, live-translate hooks, LiveTranslateSection, MyLanguageField (3eb40f24)
- 2026-11-19 E2E: doing — e2e/live-translate.spec.ts green alone on desktop, Pixel 7, iPhone 14 with the six routes answered in the browser; full npm run e2e waits for the server PR (3eb40f24)
- 2026-11-19 Screen review: todo — waits for the server PR: screens.smoke, 1280/360 light/dark against the confirmed mock (3eb40f2)
