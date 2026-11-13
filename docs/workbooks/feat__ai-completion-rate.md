# Workbook: AI completion rate in Reports

Branch: `feat/ai-completion-rate` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

## Design

Owner request (2026-11-13): "show AI completion rate in report for lite and enterprise, … how many % of success
handling case for AI that do not involve human until close". No full HTML mock: a small change to one screen, like
`ai-silent-line`. A quick mock (review page with screenshots at 1280 / 360, light and dark) was shown and confirmed
("ok go ahead"); it is not a mock baseline, the next clone still starts from `latestConfirmed` in
`docs/features/mock-index.json`.

**Rule** (the owner chose both recommended answers):

- A _case_ is one close (`chat_events` type `resolved`, by the AI or a person) of a direct chat, from the chat's
  previous close. It is an _AI case_ when the AI agent sent a reply in it (sent, not failed or pending; scheduled
  messages do not count).
- _Completed by the AI_: no `ai.handoff` in the case (the hand-off line can be the AI's first message, so the
  whole case is checked) and no message from a teammate or the linked phone after the AI's first reply. A teammate
  who only presses Close still counts.
- _Still open with the AI_: open direct chats assigned to an AI agent (not handed over, not taken by a teammate)
  with an AI reply in the period since their last close.
- _Rate_ = completed ÷ AI cases closed in the period (7, 30 or 90 days; inbox scope as the rest of Reports).
  Open chats are not in the rate. Groups never count. The change against the period before is in percentage
  points. The headline is never 100 % while the team helped in one case, nor 0 % while the AI completed one.
- Known limits (recorded in `closedAiChats`): the linked phone's own automatic messages (WhatsApp Business away or
  greeting) count as a person, as they do for "Waiting after AI hand-off"; a hand-off recorded under a chat key that
  the identity migration later merged is not matched, as in the hand-off reasons.

**Screen** (Admin → Reports, core, so Lite and Enterprise through `@ezychat/web`): a full-width card under the six
number tiles: title with an `InfoTip` ("How is the AI completion rate counted?", 3 steps), one finding line, the
rate, the change in points, a two-part bar (completed / the team helped), a legend with the counts (team helped
split into hand-offs and replies) and "N still open with the AI (not counted yet)". No AI chat closed: "–" and one
line. No AI chat closed in the period and none held by the AI now: no card (scheduled messages alone never show it).

**Contract**: `ReportTotals` gains `aiClosed`, `aiCompleted`, `aiClosedAfterHandoff`, `aiClosedAfterReply`, and
`Report` gains `aiOpen`; all default to 0 so an older server or Enterprise build still parses. No migration (the
data is already stored). Not done (owner): an Ask Ezy question for the rate.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | pass | Owner confirmed the quick mock 2026-11-13 ('ok go ahead'): full-width card under the tiles, team-helped line kept, no Ask Ezy question | bbe3c6e | 2026-11-13 |
| Dev | pass | Server count (closedAiChats, openAiChats), shared totals with defaults, Reports card with InfoTip, en/ms/zh-CN; code review: 7 fixed, 3 kept with reasons | 8e899fce | 2026-11-13 |
| Unit tests | pass | reports.test.ts (server), ReportsPage.test.tsx, i18n catalogs, web-client contract: 51 passed; typecheck shared/server/web; eslint | 8e899fce | 2026-11-13 |
| E2E | todo |  |  |  |
| Dev Build | pass | devbuild-ai-completion-check.mjs all PASS on the mock-model Dev Build: 3 closed (1 completed, 1 hand-off, 1 reply), 1 open, card 33% | ad64225 | 2026-11-13 |
| Screen review | pass | Reports card at 1280/360, light/dark, InfoTip steps: no page errors, no overflow; legend wrap fixed at 360 px; shots in docs/screenshots/reports/ai-completion-* | ad64225 | 2026-11-13 |

## Log

- 2026-11-13 Design: pass — Owner confirmed the quick mock 2026-11-13 ('ok go ahead'): full-width card under the tiles, team-helped line kept, no Ask Ezy question (bbe3c6e)
- 2026-11-13 Dev: pass — Server count (closedAiChats, openAiChats), shared totals with defaults, Reports card with InfoTip, en/ms/zh-CN; code review: 7 fixed, 3 kept with reasons (bbe3c6e)
- 2026-11-13 Unit tests: pass — reports.test.ts (server), ReportsPage.test.tsx, i18n catalogs, web-client contract: 51 passed; typecheck shared/server/web; eslint (bbe3c6e)
- 2026-11-13 Dev: pass — Server count (closedAiChats, openAiChats), shared totals with defaults, Reports card with InfoTip, en/ms/zh-CN; code review: 7 fixed, 3 kept with reasons (8e899fce)
- 2026-11-13 Unit tests: pass — reports.test.ts (server), ReportsPage.test.tsx, i18n catalogs, web-client contract: 51 passed; typecheck shared/server/web; eslint (8e899fce)
- 2026-11-13 Dev Build: pass — devbuild-ai-completion-check.mjs all PASS on the mock-model Dev Build: 3 closed (1 completed, 1 hand-off, 1 reply), 1 open, card 33% (ad64225)
- 2026-11-13 Screen review: pass — Reports card at 1280/360, light/dark, InfoTip steps: no page errors, no overflow; legend wrap fixed at 360 px; shots in docs/screenshots/reports/ai-completion-* (ad64225)
