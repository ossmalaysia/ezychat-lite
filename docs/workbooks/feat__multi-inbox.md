# Workbook: Several WhatsApp numbers (inboxes) on the Business API

Branch: `feat/multi-inbox` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | Mock round 3 confirmed by the owner 2026-10-21 (f585ace) | 2026-10-21 |
| Dev | done | Waves 1-3: foundation, per-inbox messages/queues/chats, web screens, access/routes/rooms/push, MCP/AI/stats; each task reviewed and fixed | 2026-10-21 |
| Unit tests | done | 2623 passed; RF-1..RF-5 each have a test; one socket test is flaky only under full-suite load | 2026-10-21 |
| E2E | todo |  |  |
| Dev Build | done | Two-inbox check 22/22 with the MCP SDK client; Lite MCP check 25/25; real WhatsApp second phone untested | 2026-10-21 |
| Screen review | done | 36 shots 1280/360 light+dark; one fix (Open Inboxes label); docs/screenshots/inboxes | 2026-10-21 |

## Log

- 2026-10-20 Design: doing — Mock and screen review at docs/features/multi-inbox (inboxes, access, unified list, 24-hour window); 5 open questions; waits for the owner
- 2026-10-20 Design: doing — Mock round 2: inbox types WhatsApp app (linked phone) and Business API; linked phone first; 5 open questions; waits for the owner
- 2026-10-20 Design: doing — Mock round 3: linked phone inboxes only (Business API later); 4 open questions; waits for the owner
- 2026-10-21 Dev: doing — Task 1 foundation: contract, migration 014, inbox registry, test helpers
- 2026-10-21 Design: done — Mock round 3 confirmed by the owner 2026-10-21 (f585ace)
- 2026-10-21 Dev: done — Waves 1-3: foundation, per-inbox messages/queues/chats, web screens, access/routes/rooms/push, MCP/AI/stats; each task reviewed and fixed
- 2026-10-21 Unit tests: done — 2623 passed; RF-1..RF-5 each have a test; one socket test is flaky only under full-suite load
- 2026-10-21 Dev Build: done — Two-inbox check 22/22 with the MCP SDK client; Lite MCP check 25/25; real WhatsApp second phone untested
- 2026-10-21 Screen review: done — 36 shots 1280/360 light+dark; one fix (Open Inboxes label); docs/screenshots/inboxes
