# Workbook: AI agent business templates

Branch: `feat/agent-templates` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Owner: searchable gallery window from the agent page; all four groups (17 templates, 5 categories) | 7eaee9f | 2026-10-25 |
| Dev | done | business-templates.ts, BusinessTemplateCard, Apply + confirm on own texts, item added on Save (useAddAgentText); texts en/ms/zh-CN | cc25613 | 2026-10-25 |
| Unit tests | done | AiMemberPage 47/47 (create with item, confirm/decline on own texts); business-templates 10/10 limits in 3 languages | cc25613 | 2026-10-25 |
| E2E | pass | npm run e2e 84 passed with the gallery; electron-links 16/16 on the first template commit | dce6b11 | 2026-10-25 |
| Dev Build | pass | Gallery search 'cake' → Bakery applied and saved; server stored type, texts and Bakery details item; 1280/360 px | 7eaee9f | 2026-10-25 |
| Screen review | done | Gallery at 1280 light and 360 dark, search and category states; card on the agent page; no horizontal scroll; docs/screenshots/ai-member/template-gallery-* | dce6b11 | 2026-10-25 |

## Log

- 2026-10-25 Design: done — Owner chose: templates only (Clinic, Car workshop, Tuition centre), listed on the AI agent page, choose and apply; mock waived ("just build the template only") (cc25613)
- 2026-10-25 Dev: done — business-templates.ts, BusinessTemplateCard, Apply + confirm on own texts, item added on Save (useAddAgentText); texts en/ms/zh-CN (cc25613)
- 2026-10-25 Unit tests: done — AiMemberPage 47/47 (create with item, confirm/decline on own texts); business-templates 10/10 limits in 3 languages (cc25613)
- 2026-10-25 Dev Build: pass — Clinic applied and saved on the demo agent; server stored FAQ type, texts and one Clinic details item; 1280/360 px (cc25613)
- 2026-10-25 Design: done — Owner: searchable gallery window from the agent page; all four groups (17 templates, 5 categories) (7eaee9f)
- 2026-10-25 Dev Build: pass — Gallery search 'cake' → Bakery applied and saved; server stored type, texts and Bakery details item; 1280/360 px (7eaee9f)
- 2026-10-25 E2E: pass — npm run e2e 84 passed with the gallery; electron-links 16/16 on the first template commit (dce6b11)
- 2026-10-25 Screen review: done — Gallery at 1280 light and 360 dark, search and category states; card on the agent page; no horizontal scroll; docs/screenshots/ai-member/template-gallery-* (dce6b11)
