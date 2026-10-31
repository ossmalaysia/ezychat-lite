# AI agent: answer direct chats (group-only agents)

Status: **confirmed** 2026-10-30 (see Confirmation). Branch `claude/elegant-planck-fqr14s` from `main`
(`cc0a759`).

## Owner request (2026-10-30)

- "one request that people want AI agent to only active in group chat but not direct msg, so that they can use for
  special use case for agent, the same behavior apply to baileys and whatsapp business if compatible".
- Owner answers (2026-10-30, all four recommendations):
  1. A per-agent switch **Answer direct chats**, on by default. Off + **Answer in groups** on = a group-only agent.
  2. With the switch off, a teammate **cannot** assign a direct chat to that agent (hidden from the assignee list, the
     server refuses); the direct chats the agent holds go back to the team when the switch goes off.
  3. WhatsApp Business API inboxes: the switch is **hidden** (the `wa-cloud` adapter has `capabilities.groups: false`,
     so a group-only agent there would answer nothing). Business API groups (Meta's Groups API: 8 participants, invite
     link only, Official Business Account) are a separate Enterprise feature, started in its own session.
  4. Both switches off while the agent is on: allowed, with a warning "answers no chats".

## Baseline

- Cloned from the owner-confirmed **grammar-fix** mock (`latestConfirmed`, revision
  `4a6cde7762f4aa1c1787896700d1d4c632615fec`, the whole app; `main` cc0a759 has no change to it). Its screenshots are
  not copied (git history keeps them).
- Reused, not changed: the agent page (`/admin/members/ai/:agentId`) and its Groups card (ai-groups, confirmed
  2026-10-28), the conversation header assignee select, `ConfirmDialog`, `Banner`.
- Retention: new feature folder (6th); the oldest, `google-calendar` (last revision on `main` `cc0a759`), is pruned in
  the same change.
- Built in parallel with `concept-tips` (also cloned from grammar-fix, merged first): after merging `main` this is
  creation 22 and `connector-list` is pruned instead (last revision on `main` before the merge). A later merge brought
  `ai-handoff-rules` (22): this is now creation 23 and `ai-groups` is pruned (its confirmed mock stays in git history).

## Behaviour

| Rule                 | Proposal                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Switch               | `ai_agents.answer_direct` (migration, default 1: nothing changes for existing installs).                                                                                                                       |
| Off                  | `onInbound` skips direct chats for that agent: no claim, no fallback timer, no answer, no hand-over line. Groups keep working exactly as ai-groups (tags and quotes in switched-on groups).                    |
| Turning it off       | Releases the agent's open direct chats to the team, unassigned (same path as turning the agent off), after a confirm naming the count. Pending AI timers for its direct chats are cancelled.                   |
| Assigning            | A direct chat cannot be assigned to an agent with the switch off: hidden from the assignee list, server 400 `agent_no_direct_chats`. Groups are never assigned to the AI (unchanged).                          |
| Both off             | Allowed; the card warns "answers no chats".                                                                                                                                                                    |
| Inbox without groups | Card hidden when the inbox's `WaAdapter.capabilities.groups` is false (Business API); the server treats such an agent as answering direct chats whatever the stored value, so a type change cannot silence it. |
| Unchanged            | Reply suggestions, Fix English, phrase list, customer enrichment (they use the agent's knowledge, not its on/off), Try it, Reports.                                                                            |
| Audit                | `ai.agent.update` with `answerDirect` before/after.                                                                                                                                                            |

## Screens (mock checklist)

1. Agent page → **Direct chats** card above Groups: switch on (default), off with groups on (info: answers only in
   groups), off with groups off (warning), the confirm dialog when the agent holds open direct chats.
2. Conversation header of a direct chat: the AI agent is not in the assignee list while its switch is off.
3. Business API inbox agent: no Direct chats card.
4. Desktop 1280 / mobile 360, light and dark; en, ms, zh-CN texts (`mockDirect.*`).

Screenshots: `mock/screenshots/` (`direct-shots.mjs`).

## Build plan (after confirmation)

1. Shared: `AiAgent.answerDirect` (zod default `true`), `AiAgentDirectBody`.
2. Server: migration `answer_direct`; `ai/agents.ts` `setAgentAnswerDirect`; `ai/service.ts` `onInbound` check +
   release on switch-off; `chats/service.ts` refuses the assignment; route `PUT /api/ai/agents/:agentId/direct`
   (admins); audit; tests (claim skipped, release, assign refused, Business API ignores the flag, upgrade test seed).
3. Web: `admin/AgentDirectCard.tsx`, assignee filter in `ConversationHeader`, i18n en/ms/zh-CN, tests.
4. Enterprise: none beyond the core bump (`wa-cloud` keeps `groups: false` until the Business API groups feature).

## Confirmation

The owner reviewed the screenshots (agent page with the Direct chats card above Groups, the confirm dialog on a phone,
the "answers no chats" warning, a direct chat's assignee list without the AI) and PR
ossmalaysia/ezychat-lite#229, and confirmed on 2026-10-30 ("confirm, implement it"). Mock revision
`4cfbe96dd` (the commit that added it).
