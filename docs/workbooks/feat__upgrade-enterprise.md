# Workbook: feat/upgrade-enterprise

Branch: `feat/upgrade-enterprise` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | Owner confirmed the mock 2026-10-24 after viewing the screenshots; latestConfirmed = upgrade-enterprise | 2026-10-24 |
| Dev | done | AppLinks.upgrade (Lite ezychat.ai/#enterprise, null hides); UpgradeButton/UpgradeNote; Members (Lite), AI agent limit, WhatsApp card, account menu (admins), About; ms + zh-CN | 2026-10-24 |
| Unit tests | done | UpgradeEnterprise.test (Lite, null, About, admin vs agent menu) + Members, AI agent limit, WhatsApp cases | 2026-10-24 |
| E2E | todo |  |  |
| Dev Build | todo |  |  |
| Screen review | todo |  |  |

## Log

- 2026-10-23 Design: doing — Mock docs/features/upgrade-enterprise (clone of send-reactions 82c8419): links in Members, AI agent limit, WhatsApp, account menu (admins), About; Lite only; screenshots without problems; waits for owner confirmation
- 2026-10-24 Design: done — Owner confirmed the mock 2026-10-24 after viewing the screenshots; latestConfirmed = upgrade-enterprise
- 2026-10-24 Dev: done — AppLinks.upgrade (Lite ezychat.ai/#enterprise, null hides); UpgradeButton/UpgradeNote; Members (Lite), AI agent limit, WhatsApp card, account menu (admins), About; ms + zh-CN
- 2026-10-24 Unit tests: done — UpgradeEnterprise.test (Lite, null, About, admin vs agent menu) + Members, AI agent limit, WhatsApp cases
