# Workbook: feat/simple-first-setup

Branch: `feat/simple-first-setup` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | Owner confirmed the simple-first-setup mock (90a95da) on 2026-10-15; open questions use the mock defaults | 2026-10-15 |
| Dev | done | Key-test endpoint + ChatGPT default for new installs; setup wizard Account -> WhatsApp -> AI assistant -> Ready; AiQuickConnect, Sales Agent inline connect + Advanced, Settings -> AI (ChatGPT first, Test key, Save anyway); Getting started card; Phone access label; review fixes bb71a68, aef92eb | 2026-10-15 |
| Unit tests | done | Touched Vitest files pass (ai-key-test, schemas, AiQuickConnect, AiConnectionSection, AiMemberPage, SettingsPage, AdminLayout, SetupWizard, GettingStartedCard); typecheck and lint pass | 2026-10-15 |
| E2E | pass | Full run on Node 24: 62 passed, 8 skipped, 3 failed (enrichment card now under More AI features); spec fixed, then 4/4 passed on desktop, Android, iPhone | 2026-10-15 |
| Dev Build | pass | Fresh install on 7493: wizard, real OpenAI key rejection (401) without logging the key, Finish without connection creates Kedai Farah AI + context, Getting started, inline connect, Advanced collapsed, badge click fixed, 360 px no overflow | 2026-10-15 |
| Screen review | pass | Designer review (1280/360, light/dark) findings fixed in the workflow; Dev Build screenshots match the confirmed mock | 2026-10-15 |

## Log

- 2026-10-15 Design: doing — Interactive mock docs/features/simple-first-setup (cloned from confirmed customer-enrichment 8716cb7): Account → WhatsApp → AI assistant (ChatGPT sign-in) → Ready, Getting started card, simpler Sales Agent, Settings → AI fixes; 9 actions vs ~25; awaiting owner confirmation
- 2026-10-15 Design: done — Owner confirmed the simple-first-setup mock (90a95da) on 2026-10-15; open questions use the mock defaults
- 2026-10-15 Dev: done — Key-test endpoint + ChatGPT default for new installs; setup wizard Account -> WhatsApp -> AI assistant -> Ready; AiQuickConnect, Sales Agent inline connect + Advanced, Settings -> AI (ChatGPT first, Test key, Save anyway); Getting started card; Phone access label; review fixes bb71a68, aef92eb
- 2026-10-15 Unit tests: done — Touched Vitest files pass (ai-key-test, schemas, AiQuickConnect, AiConnectionSection, AiMemberPage, SettingsPage, AdminLayout, SetupWizard, GettingStartedCard); typecheck and lint pass
- 2026-10-15 E2E: todo — main agent
- 2026-10-15 Dev Build: todo — main agent
- 2026-10-15 Screen review: doing — designer review done; final pending main agent
- 2026-10-15 E2E: pass — Full run on Node 24: 62 passed, 8 skipped, 3 failed (enrichment card now under More AI features); spec fixed, then 4/4 passed on desktop, Android, iPhone
- 2026-10-15 Dev Build: pass — Fresh install on 7493: wizard, real OpenAI key rejection (401) without logging the key, Finish without connection creates Kedai Farah AI + context, Getting started, inline connect, Advanced collapsed, badge click fixed, 360 px no overflow
- 2026-10-15 Screen review: pass — Designer review (1280/360, light/dark) findings fixed in the workflow; Dev Build screenshots match the confirmed mock
