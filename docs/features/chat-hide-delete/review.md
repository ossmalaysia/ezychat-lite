# Review log

## 2026-11-12 · PR #352 · `7687613` · risk:human (35)

**NOT READY: critical change without a real WhatsApp test; security rule: packages/server/src/inboxes/access.ts, packages/server/src/inboxes/service.ts; score 35 < 70: the owner tests and approves · risk:human (35)**

Tier **critical**, set by: packages/server/src/chats/activity.ts, packages/server/src/chats/delete.ts, packages/server/src/chats/hidden-sql.ts, packages/server/src/chats/hide.ts, packages/server/src/chats/merge.ts, packages/server/src/chats/new-chat.ts, packages/server/src/chats/repo.ts, packages/server/src/chats/service.ts and 9 more

| Item | Points | Proof |
| --- | --- | --- |
| Start | 50 | |
| Tier: critical | -30 | ✓ |
| Size: 1567 code lines | -35 | ✓ |
| Changed-lines coverage 97.4 % | +20 | ✓ |
| e2e covers the change | +10 | ✓ |
| Desktop link check | +5 | ✓ |
| Dev Build check | +10 | ✓ |
| Screen review | +5 | ✓ |
| Real-part test | 0 | ✗ missing |
| Review comments: 0 open of 0 | 0 | ✓ |
| **Score** | **35** | |

Hard stops: 1. critical change without a real WhatsApp test; 3. security rule: packages/server/src/inboxes/access.ts, packages/server/src/inboxes/service.ts

Migration: packages/server/src/db/migrations/042_deleted_chats.sql, packages/server/src/db/migrations/043_hidden_chats.sql — adds-only

Decision: **risk:human**
