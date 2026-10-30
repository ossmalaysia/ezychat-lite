# AI hand-off rules fixes: Closing chats per agent

Status: **proposal** (owner confirmation pending). Branch `claude/ezychat-handoff-rules-bugs-d2lf5w`, PR
ossmalaysia/ezychat-lite#230. Mock: [mock/index.html](mock/index.html), run instructions in [mock/README.md](mock/README.md).

## Owner request (2026-10-30)

Two AI-agent behaviours ignored the admin's hand-off rules (Anchor Sprint inbox, agent 1, sales preset):

1. "I'd like to book a free consultation" was handed over as `needs_action` although the saved rules (v87) say never to
   hand over on a consultation, meeting, demo or "book a call" request.
2. Every informational answer ended with "Does that answer your question?", and "yes we are in Malaysia" (an answer to
   another question) closed a live GPU lead with "Thank you! I will close this chat now."

Expected: the admin's "never hand over" list wins over every built-in reason except safety; the check-in line becomes a
per-agent setting, default off for the sales preset; only a clear "yes" closes a chat; never a "closing this chat" line.

## What changes on screen

Only one new card. The prompt and server fixes (consultation = discovery, rule precedence, reply/action agreement, the
"yes + new facts" guard, the waiting-after-hand-off push title) have no screen.

- Agent page → **Closing chats** card, between Connectors and Groups: one switch **Ask if the question is answered**.
  - Off (default for every agent): "{{name}} adds no check-in line and never closes a chat. Your team closes chats."
  - On (an admin switches it on): "After an answer, {{name}} asks whether it answers the question and closes the chat
    when the customer clearly says yes."
  - Saves at once (like the Groups switch); audited `ai.resolution_check_update`.
- Mock only (dashed box): the same two customer messages answered with the switch off and on.

## Baseline

- Cloned from the owner-confirmed **concept-tips** mock (`latestConfirmed`, revision
  `360d3be5ad7030d5e6fc3e8d719df223a2a6fe9d`) with `git archive`; `main` ee6c347 has no diff against it. (A first
  clone of grammar-fix was replaced when main confirmed concept-tips during this branch.) The baseline screenshots are not copied (git history keeps them).
- Reused, not changed: the Groups card layout (`AgentGroupsCard.tsx`: bordered switch row, 44 px label target, Proposed
  badge), the agent page order, the Mock only dashed-box pattern.
- Retention: new feature folder (6th); the oldest, `connector-list` (confirmed revision in the mock index
  `gitRevision`), is pruned in the same change (git history keeps it).

## Changed files (mock)

- Changed: `src/admin/AgentPage.tsx` (renders the card), `src/i18n/locales/{en,ms,zh-CN}/admin.json` (`mockResolution.*`).
- Added: `src/admin/AgentResolutionCard.tsx`, `src/mock/resolution.ts` (switch kept per agent in localStorage
  `mock.ai-resolution-check`; default off for every agent).
- Runner: `run.ts` (temp-folder name, ready line), `resolution-shots.mjs` (added), every `*-shots.mjs` usage line,
  `reference.json` (concept-tips files frozen as inherited; `snapshot.mjs --check` passes).

## Screen checklist

| State                                   | Desktop 1280 | Mobile 360 | Light | Dark |
| --------------------------------------- | ------------ | ---------- | ----- | ---- |
| Sales agent, switch off (default)       | ✓            | ✓          | ✓     | ✓    |
| Switch on (clear-yes rule)              | ✓            | ✓          | ✓     | ✓    |
| Switch kept after reload                | ✓            | ✓          | ✓     | ✓    |
| Whole agent page with the card in place | ✓            | ✓          | ✓     | ✓    |

`resolution-shots.mjs`: 12 shots, 0 problems (no page errors, no horizontal overflow). Production card shots:
`docs/screenshots/ai-member/closing-chats-*`.

## Confirmation

Confirmed 2026-10-30 by the owner in chat: the card as proposed, with the default changed to **off for every agent**
(answer "Off for every agent"; merge requested the same day).
